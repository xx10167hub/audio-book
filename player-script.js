// player-script.js - 最终版：Blob加密 + 进度条拖拽 + 复制功能 (手机显示出处修复)
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
    const copyAllBtn = document.getElementById('copy-all-btn'); 

    let sentencesData = [];
    let currentHighlightElement = null;
    let currentSentencePlayer = null;
    let isLooping = false;
    let isSeeking = false; 
    let currentLoopSentence = null;
    let isLoopSeeking = false;

    // 逐词高亮状态
    let currentWordElement = null;
    let nextWordElement = null; 
    let allWordElements = [];
    let wordTimeMap = new Map();
    
    // Blob 音频对象（用于加密链接管理）
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

    // ===== 核心修复：手机端/飞书强力复制逻辑 =====
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
            if (!response.ok) throw new Error('文章配置文件不存在');
            const config = await response.json();
            articlesConfig = config.articles;
            
            articleSelect.innerHTML = '';
            
            articlesConfig.forEach(article => {
                const option = document.createElement('option');
                option.value = article.id;
                let shortTitle = article.title;
                const match = article.title.match(/^(第\d+篇)/);
                if (match) shortTitle = match[1]; 
                else {
                    const parts = article.title.split(/[:：]/); 
                    if (parts.length > 0) shortTitle = parts[0];
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
        transcriptContainer.innerHTML = '<p style="text-align:center; color:#00ffcc;">加载中...</p>';
        updatePlayPauseButton(false);
        progressFilled.style.width = '0%';
        currentTimeDisplay.textContent = '00:00';
    }

    function loadArticleData(dataFile, audioFile, title) {
        fetch(dataFile)
            .then(response => {
                if (!response.ok) throw new Error('网络错误'); 
                return response.json();
            })
            .then(data => {
                titleElement.textContent = title || data.title;
                
                // ===== 🔥 核心修改：使用 Blob 加密加载音频 =====
                const targetAudioUrl = audioFile || data.audioUrl;
                
                // 1. 如果之前有 Blob 链接，先释放内存
                if (currentAudioBlobUrl) {
                    URL.revokeObjectURL(currentAudioBlobUrl);
                    currentAudioBlobUrl = null;
                }

                // 2. 尝试使用 fetch 获取音频并转换为 Blob
                fetch(targetAudioUrl)
                    .then(res => {
                        if (!res.ok) throw new Error('Audio fetch failed');
                        return res.blob();
                    })
                    .then(blob => {
                        // 3. 创建加密链接 (blob:http://...)
                        currentAudioBlobUrl = URL.createObjectURL(blob);
                        audioPlayer.src = currentAudioBlobUrl;
                        console.log('🔒 音频已加密加载');
                    })
                    .catch(err => {
                        console.warn('⚠️ Blob 加载失败，降级为普通加载:', err);
                        // 降级方案：直接使用普通链接，保证用户能听到声音
                        audioPlayer.src = targetAudioUrl;
                    });
                // ===== 修改结束 =====

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

                    // === 按钮组：复制按钮 ===
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

    playPauseBtn.addEventListener('click', function() {
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');
        if (audioPlayer.paused) audioPlayer.play();
        else audioPlayer.pause();
    });

    audioPlayer.addEventListener('play', function() { updatePlayPauseButton(true); });

    audioPlayer.addEventListener('pause', function() {
        updatePlayPauseButton(false);
        if (!currentSentencePlayer) resetAllSentenceButtons();
    });
    
    backwardBtn.addEventListener('click', function() {
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');
        const currentIndex = findCurrentSentenceIndex(audioPlayer.currentTime);
        let targetIndex = (currentIndex <= 0) ? 0 : currentIndex - 1;
        audioPlayer.currentTime = sentencesData[targetIndex].start;
        if (!audioPlayer.paused) audioPlayer.play();
        updateHighlightAndButton();
    });

    forwardBtn.addEventListener('click', function() {
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');
        const currentIndex = findCurrentSentenceIndex(audioPlayer.currentTime);
        if (currentIndex < sentencesData.length - 1) {
            audioPlayer.currentTime = sentencesData[currentIndex + 1].start;
            if (!audioPlayer.paused) audioPlayer.play();
            updateHighlightAndButton();
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
        } else {
            updateHighlightAndButton();
        }
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
        const isTimeMatch = currentTime >= (sentenceData.start - 0.2) && (sentenceData.end === null || currentTime < sentenceData.end);

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
        currentSentencePlayer = sentenceData;
        if (currentHighlightElement) currentHighlightElement.classList.remove('active');
        currentHighlightElement = sentenceData.element;
        currentHighlightElement.classList.add('active');
        currentHighlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        sentenceData.playButton.classList.add('paused');
        audioPlayer.currentTime = sentenceData.start;
        audioPlayer.play();
    }
    
    document.addEventListener('keydown', function(e) {
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.code === 'Space') { e.preventDefault(); playPauseBtn.click(); }
        else if (e.code === 'ArrowLeft') { e.preventDefault(); backwardBtn.click(); }
        else if (e.code === 'ArrowRight') { e.preventDefault(); forwardBtn.click(); }
        else if (e.code === 'KeyL') { e.preventDefault(); loopBtn.click(); }
    });

    if (displayMode) {
        displayMode.addEventListener('change', function() {
            transcriptContainer.classList.remove('mode-all', 'mode-original', 'mode-translation', 'mode-none');
            transcriptContainer.classList.add(`mode-${this.value}`);
        });
        displayMode.dispatchEvent(new Event('change'));
    }

    // 全文复制功能
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

    loadArticlesConfig();
});
