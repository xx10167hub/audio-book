// player-script.js - 最终版：修正连字符单词统计 + 底部悬浮 + 显示模式 + 暂停修复
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
    let isSeeking = false;
    let currentLoopSentence = null;
    let isLoopSeeking = false;

    // 逐词高亮状态
    let currentWordElement = null;
    let nextWordElement = null; 
    let allWordElements = [];
    let wordTimeMap = new Map();

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

    // ===== 核心逻辑：逐词高亮（含填补空隙） =====
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

    // ===== 加载文章配置列表 =====
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
                option.textContent = article.title;
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

    // ===== 根据ID加载文章 =====
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

    // ===== 重置播放器状态 =====
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

    // ===== 加载文章数据 =====
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
                    // --- 🔥 核心修复：更智能的词数统计 ---
                    // 1. 优先使用 words 数组（如果有），这是最准的
                    if (line.words && line.words.length > 0) {
                        totalWordCount += line.words.length;
                    } 
                    // 2. 如果没有 words 数组，使用正则统计文本
                    else {
                        const englishText = line.text.split('\n')[0]; 
                        // ✅ 修复正则：加入了短横线 '-'，现在 record-breaking 算一个词
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
                        if (target.classList.contains('play-button') || target.closest('.play-button')) {
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
    
    progressBar.addEventListener('click', function(e) {
        cancelSentencePlayerMode();
        currentLoopSentence = null;
        isLooping = false;
        loopBtn.classList.remove('active');
        
        const rect = progressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        audioPlayer.currentTime = percentage * (audioPlayer.duration || 0);
        
        if (audioPlayer.paused) {
            updateHighlightAndButton();
        }
    });
    
    audioPlayer.addEventListener('seeked', function() {
        if (!isLoopSeeking) {
            cancelSentencePlayerMode();
            currentLoopSentence = null;
        }
        isLoopSeeking = false;
        updateHighlightAndButton();
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
        } 
        else {
            updateHighlightAndButton();
        }
    });
    
    let isDragging = false;
    progressBar.addEventListener('mousedown', function() {
        isSeeking = true;
        isDragging = true;
    });
    
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isSeeking = false;
            isDragging = false;
        }
    });
    
    progressBar.addEventListener('mouseleave', function() {
        if (!isDragging) {
            isSeeking = false;
        }
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
