// player-script.js - V47 Fixed Loop Logic
// 更新内容：
// 1. 修复单句循环Bug：在静止状态先点“循环”再点“播放”时，强制重新锁定当前句子，防止顺延播放。
// 2. 保持 V46 的长标题完整写入逻辑。

document.addEventListener('DOMContentLoaded', function() {
    
    // ===== 🎛️ 核心微调参数 =====
    const START_PADDING = 0.25; // 句首提前 0.25秒 抢跑
    const END_PADDING = 0.40;   // 句尾提前 0.40秒 刹车

    // ===== 配置 =====
    const ARTICLES_CONFIG_FILE = 'articles.json';
    let articlesConfig = [];
    let currentArticleId = null;
    
    // ===== 获取 DOM 元素 =====
    const audioPlayer = document.getElementById('audio-player');
    const titleElement = document.getElementById('article-title');
    const subtitleElement = document.getElementById('article-subtitle'); // 副标题元素
    
    const transcriptContainer = document.getElementById('transcript-container');
    const speedControl = document.getElementById('speed-control');
    const displayMode = document.getElementById('display-mode'); 
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const backwardBtn = document.getElementById('backward-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const loopBtn = document.getElementById('loop-btn');
    const articleLoopBtn = document.getElementById('article-loop-btn'); 
    const progressBar = document.getElementById('progress-bar');
    const progressFilled = document.getElementById('progress-filled');
    const currentTimeDisplay = document.getElementById('current-time');
    const totalTimeDisplay = document.getElementById('total-time');
    const wordCountDisplay = document.getElementById('word-count');
    const articleSelect = document.getElementById('article-select');
    const articleSelectGroup = document.getElementById('article-select-group');
    const copyAllBtn = document.getElementById('copy-all-btn'); 

    let sentencesData = [];
    let currentHighlightElement = null;
    let currentSentencePlayer = null; 
    
    // 循环状态管理
    let isLooping = false;        
    let isArticleLooping = false; 
    
    let isSeeking = false; 
    let currentLoopSentence = null;
    let isLoopSeeking = false;

    // 逐词高亮状态
    let currentWordElement = null;
    let nextWordElement = null; 
    let allWordElements = [];
    let wordTimeMap = new Map();
    
    let currentAudioBlobUrl = null;
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

    function getSafeStartTime(originalStart) {
        return Math.max(0, originalStart - START_PADDING);
    }

    // ===== 复制逻辑 =====
    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                console.log('Modern Copy Success');
            }).catch(() => {
                fallbackCopyTextToClipboard(text);
            });
        } else {
            fallbackCopyTextToClipboard(text);
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
        } catch (err) {
            console.error('Fallback copy failed:', err);
            prompt("自动复制受限，请长按下方文字手动复制：", text);
        }
        document.body.removeChild(textArea);
    }

    function findSentenceDataByTime(currentTime) {
         for (let i = sentencesData.length - 1; i >= 0; i--) {
            if (currentTime >= sentencesData[i].start - START_PADDING - 0.1) { 
                return sentencesData[i];
            }
        }
        return null;
    }

    function findCurrentSentenceIndex(currentTime) {
        for (let i = sentencesData.length - 1; i >= 0; i--) {
            if (currentTime >= sentencesData[i].start - START_PADDING - 0.1) {
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
                if (lastSentence.end === null || lastSentence.end === 99999) {
                    if (audioPlayer.duration && audioPlayer.duration > 0 && audioPlayer.duration !== Infinity) {
                        lastSentence.end = audioPlayer.duration;
                    } else {
                        lastSentence.end = 99999;
                    }
                }
            }
        }
    }

    // 🔥 删除了 updateSelectOptionsText 函数，不再根据屏幕宽度动态截断标题

    async function loadArticlesConfig() {
        try {
            const response = await fetch(ARTICLES_CONFIG_FILE);
            if (!response.ok) throw new Error('文章配置文件不存在');
            const config = await response.json();
            articlesConfig = config.articles;
            
            articleSelect.innerHTML = '';
            
            articlesConfig.forEach(article => {
                const option = document.createElement('option');
                option.value = article.id;
                
                // 🔥 修改点：无论何时，永远塞入完整标题
                // 具体的宽度限制由 CSS 负责，浏览器会自动处理长文本截断
                option.textContent = article.title;
                
                articleSelect.appendChild(option);
            });
            
            const urlParams = new URLSearchParams(window.location.search);
            const articleIdFromUrl = urlParams.get('article');

            if (articleIdFromUrl) {
                currentArticleId = articleIdFromUrl;
                if (articleSelectGroup) articleSelectGroup.style.display = 'none';
            } else {
                currentArticleId = articlesConfig[0].id;
                if (articleSelectGroup) articleSelectGroup.style.display = 'flex';
            }

            articleSelect.value = currentArticleId;
            loadArticleById(currentArticleId);
            
        } catch (error) {
            console.error('加载配置失败:', error);
            if (articleSelectGroup) articleSelectGroup.style.display = 'none';
            loadSingleArticle();
        }
    }

    function loadArticleById(articleId) {
        const article = articlesConfig.find(a => a.id === articleId);
        if (!article) {
            if (articlesConfig.length > 0) loadArticleById(articlesConfig[0].id);
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
        
        loopBtn.classList.remove('active');
        isArticleLooping = false;
        if(articleLoopBtn) articleLoopBtn.classList.remove('active');
        
        transcriptContainer.innerHTML = '<p style="text-align:center; color:#00ffcc;">加载中...</p>';
        updatePlayPauseButton(false);
        progressFilled.style.width = '0%';
        currentTimeDisplay.textContent = '00:00';
        
        if (subtitleElement) {
            subtitleElement.textContent = '';
            subtitleElement.style.display = 'none';
        }
    }

    function cleanText(str) {
        if (!str) return "";
        return str.replace(/[^\w\u4e00-\u9fa5]/g, '').toLowerCase();
    }

    function loadArticleData(dataFile, audioFile, title) {
        fetch(dataFile)
            .then(response => {
                if (!response.ok) throw new Error('网络错误'); 
                return response.json();
            })
            .then(data => {
                const displayTitle = title || data.title;
                titleElement.textContent = displayTitle;
                
                if (subtitleElement) {
                    let subtitleText = "";
                    if (data.titleTranslation && data.titleTranslation.trim() !== "") {
                        subtitleText = data.titleTranslation;
                    } 
                    else if (data.title) {
                        const hasChinese = /[\u4e00-\u9fa5]/.test(data.title);
                        const isDuplicate = cleanText(data.title) === cleanText(displayTitle);

                        if (hasChinese && !isDuplicate) {
                            subtitleText = data.title;
                        }
                    }

                    if (subtitleText) {
                        subtitleElement.textContent = subtitleText;
                        subtitleElement.style.display = 'block';
                    } else {
                        subtitleElement.style.display = 'none';
                    }
                }
                
                const targetAudioUrl = audioFile || data.audioUrl;
                
                if (currentAudioBlobUrl) {
                    URL.revokeObjectURL(currentAudioBlobUrl);
                    currentAudioBlobUrl = null;
                }

                fetch(targetAudioUrl)
                    .then(res => {
                        if (!res.ok) throw new Error('Audio fetch failed');
                        return res.blob();
                    })
                    .then(blob => {
                        currentAudioBlobUrl = URL.createObjectURL(blob);
                        audioPlayer.src = currentAudioBlobUrl;
                        console.log('🔒 音频已加密加载');
                    })
                    .catch(err => {
                        console.warn('⚠️ Blob 加载失败，降级为普通加载:', err);
                        audioPlayer.src = targetAudioUrl;
                    });

                let totalWordCount = 0;
                transcriptContainer.innerHTML = ''; 
                if (displayMode) displayMode.dispatchEvent(new Event('change'));
                
                data.transcript.forEach((line, index) => {
                    if (line.words && line.words.length > 0) totalWordCount += line.words.length;
                    else {
                        const englishText = line.text.split('\n')[0]; 
                        const words = englishText.match(/[a-zA-Z0-9'-]+/g); 
                        if (words) totalWordCount += words.length;
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

                    const actionContainer = document.createElement('div');
                    actionContainer.className = 'sentence-actions';

                    const copySentenceBtn = document.createElement('div');
                    copySentenceBtn.className = 'copy-sentence-btn';
                    copySentenceBtn.title = "复制本句";
                    copySentenceBtn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    `;
                    
                    copySentenceBtn.addEventListener('click', function(e) {
                        e.stopPropagation(); 
                        let textToCopy = "";
                        const en = line.words ? line.words.map(w => w.text).join(' ') : line.text;
                        textToCopy += en;
                        if (line.translation) textToCopy += `\n${line.translation}`;

                        copyToClipboard(textToCopy);

                        const originalHTML = copySentenceBtn.innerHTML;
                        copySentenceBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                        copySentenceBtn.classList.add('success');
                        setTimeout(() => {
                            copySentenceBtn.innerHTML = originalHTML;
                            copySentenceBtn.classList.remove('success');
                        }, 1500);
                    });

                    actionContainer.appendChild(copySentenceBtn);

                    let endTime;
                    if (index < data.transcript.length - 1) endTime = data.transcript[index + 1].time;
                    else endTime = null;

                    const sentenceData = {
                        element: p,
                        playButton: playButton,
                        start: line.time,
                        end: endTime,
                        index: index
                    };
                    
                    p.addEventListener('click', function(event) {
                        const target = event.target;
                        if (target.classList.contains('play-button') || target.closest('.play-button') || target.closest('.text-block')) {
                            handleSentencePlayToggle(sentenceData);
                        } else {
                            handleSentencePlayFromStart(sentenceData);
                        }

                        if (displayMode && displayMode.value === 'none') {
                            const textBlock = this.querySelector('.text-block');
                            if (textBlock) {
                                if (textBlock.dataset.peekTimer) {
                                    clearTimeout(parseInt(textBlock.dataset.peekTimer));
                                }
                                textBlock.classList.add('temp-reveal');
                                const timerId = setTimeout(() => {
                                    textBlock.classList.remove('temp-reveal');
                                    delete textBlock.dataset.peekTimer;
                                }, 1000);
                                textBlock.dataset.peekTimer = timerId;
                            }
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
                            
                            if (wordIndex > 0) originalText.appendChild(document.createTextNode(' '));
                            originalText.appendChild(wordSpan);
                            allWordElements.push(wordSpan);
                            wordTimeMap.set(wordSpan, { start: wordData.start, end: wordData.end });
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
                    sentenceContent.appendChild(actionContainer);
                    p.appendChild(timeLabel);
                    p.appendChild(sentenceContent);
                    transcriptContainer.appendChild(p);
                    sentencesData.push(sentenceData);
                });
                
                if (wordCountDisplay) wordCountDisplay.textContent = `${totalWordCount} 单词`;
                isTranscriptLoaded = true;
                checkDataLoaded();
            })
            .catch(error => {
                console.error(error);
                transcriptContainer.innerHTML = `<p style="color: red;">加载失败: ${error.message}</p>`;
            });
    }

    function loadSingleArticle() {
        const urlParams = new URLSearchParams(window.location.search);
        const articleId = urlParams.get('article') || '1';
        const dataFile = `data/article-${articleId}.json`;
        loadArticleData(dataFile, null, null);
    }

    if (articleSelect) {
        articleSelect.addEventListener('change', function() {
            if (this.value !== currentArticleId) loadArticleById(this.value);
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
        if (audioPlayer.duration) totalTimeDisplay.textContent = formatTime(audioPlayer.duration);
        isAudioLoaded = true;
        checkDataLoaded();
    });

    // 🔥 核心修改：大播放键逻辑增强
    playPauseBtn.addEventListener('click', function() {
        if (audioPlayer.paused) {
            // 如果处于单句循环模式，强制刷新当前循环句，防止数据丢失
            if (isLooping) {
                currentLoopSentence = findSentenceDataByTime(audioPlayer.currentTime);
            }
            audioPlayer.play();
        } else {
            audioPlayer.pause();
        }
    });

    audioPlayer.addEventListener('play', function() { updatePlayPauseButton(true); });

    audioPlayer.addEventListener('pause', function() {
        updatePlayPauseButton(false);
        if (!currentSentencePlayer) resetAllSentenceButtons();
    });
    
    audioPlayer.addEventListener('ended', function() {
        if (isLooping && currentLoopSentence) {
            audioPlayer.currentTime = getSafeStartTime(currentLoopSentence.start);
            audioPlayer.play();
        }
        else if (isArticleLooping) {
            audioPlayer.currentTime = 0;
            audioPlayer.play();
        }
    });

    backwardBtn.addEventListener('click', function() {
        const currentIndex = findCurrentSentenceIndex(audioPlayer.currentTime);
        let targetIndex = (currentIndex <= 0) ? 0 : currentIndex - 1;
        const targetSentence = sentencesData[targetIndex];
        
        handleSentencePlayFromStart(targetSentence);
    });

    forwardBtn.addEventListener('click', function() {
        const currentIndex = findCurrentSentenceIndex(audioPlayer.currentTime);
        
        if (currentIndex < sentencesData.length - 1) {
            const targetIndex = currentIndex + 1;
            const targetSentence = sentencesData[targetIndex];
            
            handleSentencePlayFromStart(targetSentence);
        } else {
            audioPlayer.currentTime = audioPlayer.duration || 0;
            audioPlayer.pause();
        }
    });
    
    speedControl.addEventListener('change', function() { audioPlayer.playbackRate = parseFloat(this.value); });

    loopBtn.addEventListener('click', function() {
        isLooping = !isLooping;
        loopBtn.classList.toggle('active', isLooping);
        if (isLooping) {
            currentLoopSentence = findSentenceDataByTime(audioPlayer.currentTime);
            if (currentLoopSentence && audioPlayer.paused) audioPlayer.play();
        } else {
            currentLoopSentence = null;
        }
    });

    if (articleLoopBtn) {
        articleLoopBtn.addEventListener('click', function() {
            isArticleLooping = !isArticleLooping;
            articleLoopBtn.classList.toggle('active', isArticleLooping);
        });
    }

    function handleSeek(clientX) {
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');

        const rect = progressBar.getBoundingClientRect();
        let clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const percentage = clickX / rect.width;
        const duration = audioPlayer.duration || 0;
        
        if (duration > 0) {
            const newTime = percentage * duration;
            audioPlayer.currentTime = newTime;
            progressFilled.style.width = (percentage * 100) + '%';
            currentTimeDisplay.textContent = formatTime(newTime);
        }
    }

    let isDragging = false;
    progressBar.addEventListener('mousedown', function(e) { isSeeking = true; isDragging = true; handleSeek(e.clientX); });
    document.addEventListener('mousemove', function(e) { if (isDragging) handleSeek(e.clientX); });
    document.addEventListener('mouseup', function() { if (isDragging) { isSeeking = false; isDragging = false; } });
    progressBar.addEventListener('touchstart', function(e) { isSeeking = true; isDragging = true; handleSeek(e.touches[0].clientX); }, { passive: false });
    document.addEventListener('touchmove', function(e) { if (isDragging) { e.preventDefault(); handleSeek(e.touches[0].clientX); } }, { passive: false });
    document.addEventListener('touchend', function() { isSeeking = false; isDragging = false; });

    audioPlayer.addEventListener('timeupdate', function() {
        const currentTime = audioPlayer.currentTime; 
        if (!isSeeking) {
            const progress = (currentTime / (audioPlayer.duration || 1)) * 100;
            progressFilled.style.width = progress + '%';
            currentTimeDisplay.textContent = formatTime(currentTime);
        }
        
        // 双重保险：如果开启了循环但目标丢失，尝试重新捕获
        if (isLooping && !currentLoopSentence) {
            currentLoopSentence = findSentenceDataByTime(audioPlayer.currentTime);
        }

        if (isLooping && currentLoopSentence && currentLoopSentence.end) {
            if (currentTime >= currentLoopSentence.end - END_PADDING) {
                isLoopSeeking = true;
                audioPlayer.currentTime = getSafeStartTime(currentLoopSentence.start);
            }
        }
        
        let searchTime = currentTime;
        let targetS = isLooping ? currentLoopSentence : currentSentencePlayer;
        if (targetS && currentTime < targetS.start) {
             if (currentTime > targetS.start - START_PADDING - 0.2) {
                 searchTime = targetS.start + 0.01; 
             }
        }

        const currentWord = findCurrentWord(searchTime);
        highlightCurrentWord(currentWord);
        
        updateHighlightAndButton();
    });
    
    audioPlayer.addEventListener('seeked', function() {
        isLoopSeeking = false;
        updateHighlightAndButton();
    });

    function updateHighlightAndButton() {
        const sentenceData = findSentenceDataByTime(audioPlayer.currentTime);
        if (sentenceData) {
            const foundElement = sentenceData.element;
            const foundButton = sentenceData.playButton;
            if (foundElement && foundElement !== currentHighlightElement) {
                if (currentHighlightElement) currentHighlightElement.classList.remove('active');
                foundElement.classList.add('active');
                currentHighlightElement = foundElement;
                if (!currentSentencePlayer) foundElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (foundButton) {
                resetAllSentenceButtons();
                if (!audioPlayer.paused) foundButton.classList.add('paused');
            }
        }
    }

    function handleSentencePlayToggle(sentenceData) {
        const currentTime = audioPlayer.currentTime;
        const safeStart = getSafeStartTime(sentenceData.start);
        
        const isTimeMatch = currentTime >= (safeStart - 0.2) && (sentenceData.end === null || currentTime < sentenceData.end);

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
        
        if (isLooping) {
            currentLoopSentence = sentenceData;
        } else {
            currentLoopSentence = null;
            loopBtn.classList.remove('active'); 
        }

        currentSentencePlayer = sentenceData;
        if (currentHighlightElement) currentHighlightElement.classList.remove('active');
        currentHighlightElement = sentenceData.element;
        currentHighlightElement.classList.add('active');
        currentHighlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        sentenceData.playButton.classList.add('paused');
        
        audioPlayer.currentTime = getSafeStartTime(sentenceData.start);
        audioPlayer.play();
    }
    
    document.addEventListener('keydown', function(e) {
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.code === 'Space') { e.preventDefault(); playPauseBtn.click(); }
        else if (e.code === 'ArrowLeft') { e.preventDefault(); backwardBtn.click(); }
        else if (e.code === 'ArrowRight') { e.preventDefault(); forwardBtn.click(); }
        else if (e.code === 'KeyL') { e.preventDefault(); loopBtn.click(); }
    });

    if (copyAllBtn) {
        copyAllBtn.addEventListener('click', function() {
            if (!sentencesData || sentencesData.length === 0) {
                alert("内容尚未加载");
                return;
            }
            let fullText = `【标题】${titleElement.textContent}\n\n`;
            sentencesData.forEach(item => {
                const original = item.element.querySelector('.original-text');
                const enText = original ? original.innerText.replace(/[\r\n]+/g, ' ') : "";
                const trans = item.element.querySelector('.translation');
                const cnText = trans ? trans.innerText : "";
                if (enText) fullText += `${enText}\n`;
                if (cnText) fullText += `${cnText}\n`;
                fullText += `\n`; 
            });
            fullText += `\n(内容来自：沉浸式精听播放器 - 小红书@lumie鹿米)`;
            copyToClipboard(fullText);

            const originalHTML = copyAllBtn.innerHTML;
            copyAllBtn.innerHTML = `✅ 已复制`;
            copyAllBtn.style.borderColor = "#10b981";
            copyAllBtn.style.color = "#10b981";
            setTimeout(() => {
                copyAllBtn.innerHTML = originalHTML;
                copyAllBtn.style.borderColor = "";
                copyAllBtn.style.color = "";
            }, 2000);
        });
    }

    const STOP_WORDS = new Set([
        'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'about',
        'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
        'and', 'but', 'or', 'so', 'if', 'because', 'as', 'that', 'this', 'it', 'he', 'she', 'they', 'we', 'i', 'you',
        'my', 'your', 'his', 'her', 'their', 'our', 'us', 'him', 'them'
    ]);

    const ANCHOR_WORDS = new Set([
        'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'about', 'of', 
        'and', 'but', 'or', 'so', 'as', 'into', 'like', 'than', 'over'
    ]);

    function generateClozeMode() {
        allWordElements.forEach(el => el.classList.remove('cloze-hidden'));

        const sentences = transcriptContainer.querySelectorAll('.sentence');

        sentences.forEach(sentence => {
            const wordsInSentence = Array.from(sentence.querySelectorAll('.word-highlight'));
            const totalWords = wordsInSentence.length;

            if (totalWords === 0) return;

            let targetHideCount = 0;
            if (totalWords <= 5) {
                targetHideCount = totalWords; 
            } else {
                targetHideCount = Math.ceil(totalWords * 0.75); 
            }

            const wordDetails = wordsInSentence.map((el, index) => {
                const rawText = el.textContent.trim(); 
                const wordText = rawText.toLowerCase().replace(/[.,?!:;"'()]/g, '');
                const isNum = /\d/.test(wordText); 
                const isStop = STOP_WORDS.has(wordText);
                const len = wordText.length;
                
                const isCapitalized = /^[A-Z]/.test(rawText);

                let score = 0;

                if (index === 0 && !isNum && (isStop || len <= 4)) {
                    score = -1000; 
                } else if (isNum) {
                    score = 100;   
                } else if (!isStop && len >= 7) {
                    score = 50;    
                } else if (!isStop && len >= 4) {
                    score = 40;    
                } else if (!isStop) {
                    score = 20;    
                } else {
                    score = 1;     
                }
                
                if (index > 0 && isCapitalized && rawText !== 'I') {
                    score = -9999; 
                }

                score += Math.random() * 5;
                return { el, score, isStop, wordText };
            });

            wordDetails.sort((a, b) => b.score - a.score);
            for (let i = 0; i < targetHideCount; i++) {
                if (wordDetails[i].score < 0) continue; 
                wordDetails[i].el.classList.add('cloze-hidden');
            }

            wordsInSentence.forEach((el, index) => {
                if (index === 0) return; 

                if (!el.classList.contains('cloze-hidden') && wordDetails.find(w => w.el === el).isStop) {
                    let leftHidden = (index > 0 && wordsInSentence[index-1].classList.contains('cloze-hidden'));
                    let rightHidden = (index < totalWords - 1 && wordsInSentence[index+1].classList.contains('cloze-hidden'));
                    
                    if ((leftHidden || rightHidden) && Math.random() < 0.6) {
                        el.classList.add('cloze-hidden');
                    }
                }
            });

            if (totalWords > 7) {
                wordsInSentence.forEach((el, index) => {
                    if (index === 0 || index === totalWords - 1) return;

                    const cleanText = el.textContent.trim().toLowerCase().replace(/[.,?!:;"'()]/g, '');

                    if (el.classList.contains('cloze-hidden') && ANCHOR_WORDS.has(cleanText)) {
                        if (Math.random() < 0.5) {
                            el.classList.remove('cloze-hidden');
                        }
                    }
                });
            }

        });
    }

    if (displayMode) {
        displayMode.addEventListener('change', function() {
            transcriptContainer.classList.remove('mode-all', 'mode-original', 'mode-translation', 'mode-none', 'mode-cloze');
            
            const currentMode = this.value;
            transcriptContainer.classList.add(`mode-${currentMode}`);

            if (currentMode === 'cloze') {
                generateClozeMode();
            } else {
                allWordElements.forEach(el => el.classList.remove('cloze-hidden'));
            }
        });
        
        displayMode.dispatchEvent(new Event('change'));
    }

    loadArticlesConfig();
});

(function() {
    console.log("Applying Huawei Tablet Patch...");

    var targetSlider = document.getElementById('progress-bar') || document.querySelector('input[type="range"]');

    if (targetSlider) {
        targetSlider.addEventListener('touchstart', function(e) {
            e.stopPropagation(); 
        }, { passive: false });

        targetSlider.addEventListener('touchmove', function(e) {
            e.stopPropagation(); 
            if (e.cancelable) {
                e.preventDefault(); 
            }
        }, { passive: false });
    }

    function unlockAudio() {
        var audioEl = document.querySelector('audio'); 
        if (audioEl) {
            if (!audioEl.paused) {
                document.removeEventListener('touchstart', unlockAudio);
                document.removeEventListener('click', unlockAudio);
                return;
            }

            var playPromise = audioEl.play();
            if (playPromise !== undefined) {
                playPromise.then(function() {
                    audioEl.pause();
                }).catch(function(error) {
                    console.log("Audio unlock attempt: " + error);
                });
            }
        }
        document.removeEventListener('touchstart', unlockAudio);
        document.removeEventListener('click', unlockAudio);
    }

    document.addEventListener('touchstart', unlockAudio, { passive: false });
    document.addEventListener('click', unlockAudio);

})();
