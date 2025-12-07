// player-script.js - 最终修复版：支持进度条拖拽 + 手机触摸 + 单词互动
document.addEventListener('DOMContentLoaded', function() {
    
    // ===== 配置 =====
    const ARTICLES_CONFIG_FILE = 'articles.json';
    let articlesConfig = [];
    let currentArticleId = null;
    
    // ===== 获取 DOM 元素 =====
    const audioPlayer = document.getElementById('audio-player');
    const titleElement = document.getElementById('article-title');
    const transcriptContainer = document.getElementById('transcript-container');
    const speedControl = document.getElementById('speed-control');
    const displayMode = document.getElementById('display-mode'); 
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const backwardBtn = document.getElementById('backward-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const loopBtn = document.getElementById('loop-btn');
    const progressBar = document.getElementById('progress-bar');
    const progressFilled = document.getElementById('progress-filled');
    const currentTimeDisplay = document.getElementById('current-time');
    const totalTimeDisplay = document.getElementById('total-time');
    const wordCountDisplay = document.getElementById('word-count');
    const articleSelect = document.getElementById('article-select');
    const articleSelectGroup = document.getElementById('article-select-group');

    let sentencesData = [];
    let currentHighlightElement = null;
    let currentSentencePlayer = null;
    let isLooping = false;
    let isSeeking = false; // 标记是否正在拖拽中，防止 timeupdate 干扰
    let currentLoopSentence = null;
    let isLoopSeeking = false;

    // 逐词高亮状态
    let currentWordElement = null;
    let nextWordElement = null; 
    let allWordElements = [];
    let wordTimeMap = new Map();

    // 互动状态
    let activeInteractionIndex = -1; 
    let activePopup = null; 

    let isTranscriptLoaded = false;
    let isAudioLoaded = false;

    function formatTime(seconds) {
        if (isNaN(seconds)) return '00:00';
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function resetAllSentenceButtons() {
        sentencesData.forEach(s => {
            if (s.playButton) {
                s.playButton.classList.remove('paused');
            }
        });
    }

    function cancelSentencePlayerMode() {
        if (currentSentencePlayer) {
            currentSentencePlayer.playButton.classList.remove('paused');
            currentSentencePlayer = null; 
        }
    }

    // 关闭互动模式
    function closeInteractionMode() {
        if (activeInteractionIndex !== -1) {
            const sentenceEl = document.getElementById(`sentence-${activeInteractionIndex}`);
            if (sentenceEl) {
                sentenceEl.classList.remove('interaction-active');
                const btn = sentenceEl.querySelector('.interact-btn');
                if (btn) btn.classList.remove('active');
            }
            activeInteractionIndex = -1;
            closePopup();
        }
    }

    // 关闭气泡
    function closePopup() {
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }
    }

    // ===== 🔥 核心修复：手机端/飞书强力复制逻辑 =====
    function copyToClipboard(text) {
        const cleanText = text.replace(/[.,!?;:"]/g, '');

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(cleanText).then(() => {
                console.log('Modern Copy Success');
            }).catch(() => {
                fallbackCopyTextToClipboard(cleanText);
            });
        } else {
            fallbackCopyTextToClipboard(cleanText);
        }
    }

    function fallbackCopyTextToClipboard(text) {
        var textArea = document.createElement("textarea");
        textArea.value = text;
        
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        textArea.style.fontSize = '12pt'; 
        
        document.body.appendChild(textArea);
        
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, 999999); 

        try {
            var successful = document.execCommand('copy');
            if (!successful) throw new Error('Copy command failed');
            console.log('Fallback copy successful');
        } catch (err) {
            console.error('Fallback copy failed:', err);
            prompt("自动复制受限，请长按下方文字手动复制：", text);
        }

        document.body.removeChild(textArea);
    }

    function findSentenceDataByTime(currentTime) {
         for (let i = sentencesData.length - 1; i >= 0; i--) {
            if (currentTime >= sentencesData[i].start - 0.1) { 
                return sentencesData[i];
            }
        }
        return null;
    }

    function findCurrentSentenceIndex(currentTime) {
        for (let i = sentencesData.length - 1; i >= 0; i--) {
            if (currentTime >= sentencesData[i].start - 0.1) {
                return i;
            }
        }
        return -1;
    }

    function findCurrentWord(currentTime) {
        const MAX_GAP_TO_FILL = 1.5; 

        for (let i = 0; i < allWordElements.length; i++) {
            const currentElement = allWordElements[i];
            const currentData = wordTimeMap.get(currentElement);
            
            let nextData = null;
            if (i < allWordElements.length - 1) {
                nextData = wordTimeMap.get(allWordElements[i + 1]);
            }

            let visualEndTime = currentData.end;
            
            if (nextData) {
                const gap = nextData.start - currentData.end;
                if (gap > 0 && gap < MAX_GAP_TO_FILL) {
                    visualEndTime = nextData.start;
                }
            }

            if (currentTime >= currentData.start && currentTime < visualEndTime) {
                return { element: currentElement };
            }
        }
        return null;
    }

    function highlightCurrentWord(currentWord) {
        if (currentWordElement) {
            currentWordElement.classList.remove('current');
        }
        if (nextWordElement) {
            nextWordElement.classList.remove('next');
            nextWordElement = null;
        }
        
        if (currentWord) {
            currentWordElement = currentWord.element;
            currentWordElement.classList.add('current');
        }
    }

    function checkDataLoaded() {
        if (isTranscriptLoaded && isAudioLoaded) {
            if (sentencesData.length > 0) {
                const lastSentence = sentencesData[sentencesData.length - 1];
                if (lastSentence.end === null) {
                    lastSentence.end = audioPlayer.duration || 99999;
                }
            }
        }
    }

    // 根据屏幕宽度更新下拉框文字
    function updateSelectOptionsText() {
        if (!articleSelect || articleSelect.options.length === 0) return;
        
        const isMobile = window.innerWidth < 768;
        
        Array.from(articleSelect.options).forEach(option => {
            if (option.dataset.full && option.dataset.short) {
                option.textContent = isMobile ? option.dataset.short : option.dataset.full;
            }
        });
    }

    window.addEventListener('resize', updateSelectOptionsText);

    async function loadArticlesConfig() {
        try {
            const response = await fetch(ARTICLES_CONFIG_FILE);
            if (!response.ok) {
                throw new Error('文章配置文件不存在');
            }
            const config = await response.json();
            articlesConfig = config.articles;
            
            articleSelect.innerHTML = '';
            
            articlesConfig.forEach(article => {
                const option = document.createElement('option');
                option.value = article.id;
                
                let shortTitle = article.title;
                const match = article.title.match(/^(第\d+篇)/);
                
                if (match) {
                    shortTitle = match[1]; 
                } else {
                    const parts = article.title.split(/[:：]/); 
                    if (parts.length > 0) {
                        shortTitle = parts[0];
                    }
                }

                option.dataset.full = article.title;
                option.dataset.short = shortTitle;
                
                const isMobile = window.innerWidth < 768;
                option.textContent = isMobile ? shortTitle : article.title;

                articleSelect.appendChild(option);
            });
            
            const urlParams = new URLSearchParams(window.location.search);
            const articleIdFromUrl = urlParams.get('article');

            if (articleIdFromUrl) {
                console.log('检测到URL指定文章:', articleIdFromUrl);
                currentArticleId = articleIdFromUrl;
                if (articleSelectGroup) {
                    articleSelectGroup.style.display = 'none';
                }
            } else {
                currentArticleId = articlesConfig[0].id;
                if (articleSelectGroup) {
                    articleSelectGroup.style.display = 'flex';
                }
            }

            articleSelect.value = currentArticleId;
            loadArticleById(currentArticleId);
            
        } catch (error) {
            console.error('加载文章配置失败:', error);
            if (articleSelectGroup) articleSelectGroup.style.display = 'none';
            loadSingleArticle();
        }
    }

    function loadArticleById(articleId) {
        const article = articlesConfig.find(a => a.id === articleId);
        if (!article) {
            console.error('找不到文章:', articleId);
            if (articlesConfig.length > 0) {
                loadArticleById(articlesConfig[0].id);
            }
            return;
        }
        
        currentArticleId = articleId;
        resetPlayerState();
        loadArticleData(article.dataFile, article.audioFile, article.title);
    }

    function resetPlayerState() {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        
        sentencesData = [];
        allWordElements = [];
        wordTimeMap.clear();
        currentWordElement = null;
        nextWordElement = null;
        currentHighlightElement = null;
        currentSentencePlayer = null;
        isLooping = false;
        currentLoopSentence = null;
        isTranscriptLoaded = false;
        isAudioLoaded = false;
        
        closeInteractionMode();

        loopBtn.classList.remove('active');
        transcriptContainer.innerHTML = '<p style="text-align:center; color:#00ffcc;">加载中...</p>';
        updatePlayPauseButton(false);
        progressFilled.style.width = '0%';
        currentTimeDisplay.textContent = '00:00';
    }

    function loadArticleData(dataFile, audioFile, title) {
        fetch(dataFile)
            .then(response => {
                if (!response.ok) { 
                    throw new Error('网络错误，找不到数据文件'); 
                }
                return response.json();
            })
            .then(data => {
                titleElement.textContent = title || data.title;
                audioPlayer.src = audioFile || data.audioUrl; 
                
                let totalWordCount = 0;
                transcriptContainer.innerHTML = ''; 
                
                if (displayMode) {
                    displayMode.dispatchEvent(new Event('change'));
                }
                
                data.transcript.forEach((line, index) => {
                    if (line.words && line.words.length > 0) {
                        totalWordCount += line.words.length;
                    } 
                    else {
                        const englishText = line.text.split('\n')[0]; 
                        const words = englishText.match(/[a-zA-Z0-9'-]+/g); 
                        if (words) {
                            totalWordCount += words.length;
                        }
                    }
                    
                    const p = document.createElement('p');
                    p.className = 'sentence';
                    p.id = `sentence-${index}`;
                    
                    const timeLabel = document.createElement('span');
                    timeLabel.className = 'time-label';
                    timeLabel.textContent = formatTime(line.time);
                    
                    const sentenceContent = document.createElement('div');
                    sentenceContent.className = 'sentence-content';
                    
                    const playButton = document.createElement('div');
                    playButton.className = 'play-button';

                    // 互动按钮（小手）
                    const interactBtn = document.createElement('div');
                    interactBtn.className = 'interact-btn';
                    interactBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                    `;
                    interactBtn.title = "点击进入查词模式";

                    let endTime;
                    if (index < data.transcript.length - 1) {
                        endTime = data.transcript[index + 1].time;
                    } else {
                        endTime = null;
                    }

                    const sentenceData = {
                        element: p,
                        playButton: playButton,
                        start: line.time,
                        end: endTime,
                        index: index
                    };
                    
                    p.addEventListener('click', function(event) {
                        const target = event.target;

                        if (activeInteractionIndex === index) {
                            if (target.closest('.interact-btn')) {
                                closeInteractionMode();
                            } else if (!target.closest('.word-highlight') && !target.closest('.word-popup')) {
                                closeInteractionMode();
                            }
                            return; 
                        }

                        if (target.closest('.interact-btn')) {
                            closeInteractionMode();
                            activeInteractionIndex = index;
                            p.classList.add('interaction-active');
                            target.closest('.interact-btn').classList.add('active');
                            if (!audioPlayer.paused) audioPlayer.pause();
                            return;
                        }

                        if (target.classList.contains('play-button') || target.closest('.play-button') || target.closest('.text-block')) {
                            handleSentencePlayToggle(sentenceData);
                        } else {
                            handleSentencePlayFromStart(sentenceData);
                        }
                    });
                    
                    const textBlock = document.createElement('div');
                    textBlock.className = 'text-block';
                    
                    if (line.words && line.words.length > 0) {
                        const originalText = document.createElement('span');
                        originalText.className = 'original-text';
                        
                        line.words.forEach((wordData, wordIndex) => {
                            const wordSpan = document.createElement('span');
                            wordSpan.className = 'word-highlight';
                            wordSpan.textContent = wordData.text;
                            wordSpan.dataset.start = wordData.start;
                            wordSpan.dataset.end = wordData.end;
                            
                            wordSpan.addEventListener('click', function(e) {
                                if (activeInteractionIndex === index) {
                                    e.stopPropagation();
                                    showWordPopup(wordSpan, wordData);
                                }
                            });

                            if (wordIndex > 0) {
                                const space = document.createTextNode(' ');
                                originalText.appendChild(space);
                            }
                            
                            originalText.appendChild(wordSpan);
                            allWordElements.push(wordSpan);
                            wordTimeMap.set(wordSpan, {
                                start: wordData.start,
                                end: wordData.end
                            });
                        });
                        
                        textBlock.appendChild(originalText);
                    } else {
                        const originalText = document.createElement('span');
                        originalText.className = 'original-text';
                        originalText.textContent = line.text;
                        textBlock.appendChild(originalText);
                    }
                    
                    if (line.translation) {
                        const translation = document.createElement('span');
                        translation.className = 'translation';
                        translation.textContent = line.translation;
                        textBlock.appendChild(translation);
                    }
                    
                    sentenceContent.appendChild(playButton);
                    sentenceContent.appendChild(textBlock);
                    sentenceContent.appendChild(interactBtn);
                    p.appendChild(timeLabel);
                    p.appendChild(sentenceContent);
                    transcriptContainer.appendChild(p);
                    
                    sentencesData.push(sentenceData);
                });
                
                if (wordCountDisplay) {
                    wordCountDisplay.textContent = `${totalWordCount} 单词`;
                }
                
                isTranscriptLoaded = true;
                checkDataLoaded();
            })
            .catch(error => {
                console.error('加载数据失败:', error);
                transcriptContainer.innerHTML = `<p style="color: red;">加载文章失败: ${error.message}</p>`;
            });
    }

    function showWordPopup(wordSpan, wordData) {
        closePopup(); 

        const popup = document.createElement('div');
        popup.className = 'word-popup';
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'popup-btn';
        copyBtn.innerHTML = '📋 复制';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyToClipboard(wordData.text);
            copyBtn.innerHTML = '✅ 已复制';
            setTimeout(() => { if(popup) closePopup(); }, 800);
        };

        popup.appendChild(copyBtn);
        
        document.body.appendChild(popup);
        activePopup = popup;

        const rect = wordSpan.getBoundingClientRect();
        const popupHeight = 40; 
        let top = rect.top - popupHeight - 10;
        let left = rect.left + rect.width / 2;
        
        popup.style.top = top + 'px';
        popup.style.left = left + 'px';
    }

    document.addEventListener('click', function(e) {
        if (activePopup && !e.target.closest('.word-popup') && !e.target.closest('.word-highlight')) {
            closePopup();
        }
    });

    function loadSingleArticle() {
        const urlParams = new URLSearchParams(window.location.search);
        const articleId = urlParams.get('article') || '1';
        const dataFile = `data/article-${articleId}.json`;
        loadArticleData(dataFile, null, null);
    }

    if (articleSelect) {
        articleSelect.addEventListener('change', function() {
            const selectedId = this.value;
            if (selectedId !== currentArticleId) {
                loadArticleById(selectedId);
            }
        });
    }
    
    function updatePlayPauseButton(isPlaying) {
        if (isPlaying) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
        } else {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        }
    }

    audioPlayer.addEventListener('loadedmetadata', function() {
        if (audioPlayer.duration) {
            totalTimeDisplay.textContent = formatTime(audioPlayer.duration);
        }
        isAudioLoaded = true;
        checkDataLoaded();
    });

    playPauseBtn.addEventListener('click', function() {
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');
        closeInteractionMode();
        
        if (audioPlayer.paused) {
            audioPlayer.play();
        } else {
            audioPlayer.pause();
        }
    });

    audioPlayer.addEventListener('play', function() {
        updatePlayPauseButton(true);
    });

    audioPlayer.addEventListener('pause', function() {
        updatePlayPauseButton(false);
        if (!currentSentencePlayer) {
            resetAllSentenceButtons();
        }
    });
    
    backwardBtn.addEventListener('click', function() {
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');
        closeInteractionMode();
        
        const currentIndex = findCurrentSentenceIndex(audioPlayer.currentTime);
        let targetIndex;
        
        if (currentIndex <= 0) {
             targetIndex = 0;
        } else {
             targetIndex = currentIndex - 1;
        }
        
        audioPlayer.currentTime = sentencesData[targetIndex].start;
        if (!audioPlayer.paused) {
            audioPlayer.play();
        }
        updateHighlightAndButton();
    });

    forwardBtn.addEventListener('click', function() {
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');
        closeInteractionMode();
        
        const currentIndex = findCurrentSentenceIndex(audioPlayer.currentTime);
        
        if (currentIndex < sentencesData.length - 1) {
            const nextIndex = currentIndex + 1;
            audioPlayer.currentTime = sentencesData[nextIndex].start;
            if (!audioPlayer.paused) {
                audioPlayer.play();
            }
            updateHighlightAndButton();
        } else {
            audioPlayer.currentTime = audioPlayer.duration || 0;
            audioPlayer.pause();
        }
    });
    
    speedControl.addEventListener('change', function() {
        audioPlayer.playbackRate = parseFloat(this.value);
    });

    loopBtn.addEventListener('click', function() {
        isLooping = !isLooping;
        loopBtn.classList.toggle('active', isLooping);
        
        if (isLooping) {
            const currentTime = audioPlayer.currentTime;
            currentLoopSentence = findSentenceDataByTime(currentTime);
            
            if (currentLoopSentence) {
                if (audioPlayer.paused) {
                    audioPlayer.play();
                }
            }
        } else {
            currentLoopSentence = null;
        }
    });

    // ==========================================
    // 🔥 进度条核心逻辑：拖拽 + 触摸 + 点击
    // ==========================================

    // 处理跳转计算的通用函数
    function handleSeek(clientX) {
        // 1. 重置所有播放状态，避免冲突
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');
        closeInteractionMode();

        // 2. 计算进度位置
        const rect = progressBar.getBoundingClientRect();
        let clickX = clientX - rect.left;
        
        // 限制边界，防止拖出范围导致数值异常
        clickX = Math.max(0, Math.min(clickX, rect.width));

        const percentage = clickX / rect.width;
        const duration = audioPlayer.duration || 0;
        
        if (duration > 0) {
            const newTime = percentage * duration;
            audioPlayer.currentTime = newTime;
            
            // 立即更新UI，不等timeupdate，更跟手
            progressFilled.style.width = (percentage * 100) + '%';
            currentTimeDisplay.textContent = formatTime(newTime);
        }
    }

    let isDragging = false;

    // --- 鼠标事件 (PC) ---
    progressBar.addEventListener('mousedown', function(e) {
        isSeeking = true;
        isDragging = true;
        handleSeek(e.clientX);
    });

    document.addEventListener('mousemove', function(e) {
        if (isDragging) {
            handleSeek(e.clientX);
        }
    });

    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isSeeking = false;
            isDragging = false;
        }
    });

    // --- 触摸事件 (手机/平板) ---
    progressBar.addEventListener('touchstart', function(e) {
        isSeeking = true;
        isDragging = true;
        handleSeek(e.touches[0].clientX);
    }, { passive: false });

    document.addEventListener('touchmove', function(e) {
        if (isDragging) {
            e.preventDefault(); // 禁止页面滚动，只拖动进度条
            handleSeek(e.touches[0].clientX);
        }
    }, { passive: false });

    document.addEventListener('touchend', function() {
        isSeeking = false;
        isDragging = false;
    });


    // ==========================================
    // 时间更新逻辑
    // ==========================================
    audioPlayer.addEventListener('timeupdate', function() {
        const currentTime = audioPlayer.currentTime; 
        
        // 只有当没有在手动拖拽时，才更新进度条，避免“打架”
        if (!isSeeking) {
            const progress = (currentTime / (audioPlayer.duration || 1)) * 100;
            progressFilled.style.width = progress + '%';
            currentTimeDisplay.textContent = formatTime(currentTime);
        }
        
        // 循环模式逻辑
        if (isLooping && currentLoopSentence && currentLoopSentence.end) {
            if (currentTime >= currentLoopSentence.end - 0.15) {
                isLoopSeeking = true;
                audioPlayer.currentTime = currentLoopSentence.start;
            }
        }
        
        const currentWord = findCurrentWord(currentTime);
        highlightCurrentWord(currentWord);
        
        if (currentSentencePlayer) {
            if (currentSentencePlayer.end && currentTime >= currentSentencePlayer.end - 0.1) { 
                audioPlayer.pause(); 
                audioPlayer.currentTime = currentSentencePlayer.start;
                cancelSentencePlayerMode();
            }
        } 
        else {
            updateHighlightAndButton();
        }
    });
    
    // 循环播放 Seek 完成后的处理
    audioPlayer.addEventListener('seeked', function() {
        if (!isLoopSeeking) {
            // 如果不是循环引起的跳转，则取消单句循环
            // cancelSentencePlayerMode(); // 注释掉，避免手动拖动时打断当前播放逻辑太生硬，看需求保留
        }
        isLoopSeeking = false;
        updateHighlightAndButton();
    });

    function updateHighlightAndButton() {
        const sentenceData = findSentenceDataByTime(audioPlayer.currentTime);

        if (sentenceData) {
            const foundElement = sentenceData.element;
            const foundButton = sentenceData.playButton;
            
            if (foundElement && foundElement !== currentHighlightElement) {
                if (currentHighlightElement) {
                    currentHighlightElement.classList.remove('active');
                }
                foundElement.classList.add('active');
                currentHighlightElement = foundElement;
                
                if (!currentSentencePlayer) {
                    foundElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
            
            if (foundButton) {
                resetAllSentenceButtons();
                if (!audioPlayer.paused) {
                    foundButton.classList.add('paused');
                }
            }
        }
    }

    function handleSentencePlayToggle(sentenceData) {
        const currentTime = audioPlayer.currentTime;
        const isTimeMatch = currentTime >= (sentenceData.start - 0.2) && 
                           (sentenceData.end === null || currentTime < sentenceData.end);

        if (sentenceData === currentSentencePlayer || (currentSentencePlayer === null && isTimeMatch)) {
            if (audioPlayer.paused) {
                audioPlayer.play();
                sentenceData.playButton.classList.add('paused');
            } else {
                audioPlayer.pause();
                sentenceData.playButton.classList.remove('paused');
            }
        } else {
            handleSentencePlayFromStart(sentenceData);
        }
    }
    
    function handleSentencePlayFromStart(sentenceData) {
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');
        closeInteractionMode();
        
        currentSentencePlayer = sentenceData;
        
        if (currentHighlightElement) {
            currentHighlightElement.classList.remove('active');
        }
        currentHighlightElement = sentenceData.element;
        currentHighlightElement.classList.add('active');
        currentHighlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        sentenceData.playButton.classList.add('paused');
        audioPlayer.currentTime = sentenceData.start;
        audioPlayer.play();
    }
    
    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
        
        if (e.code === 'Space') {
            e.preventDefault();
            playPauseBtn.click(); 
        }
        else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            backwardBtn.click(); 
        }
        else if (e.code === 'ArrowRight') {
            e.preventDefault();
            forwardBtn.click(); 
        }
        else if (e.code === 'KeyL') {
            e.preventDefault();
            loopBtn.click();
        }
    });

    if (displayMode) {
        displayMode.addEventListener('change', function() {
            const mode = this.value;
            transcriptContainer.classList.remove('mode-all', 'mode-original', 'mode-translation', 'mode-none');
            transcriptContainer.classList.add(`mode-${mode}`);
        });
        
        displayMode.dispatchEvent(new Event('change'));
    }

    loadArticlesConfig();

});
