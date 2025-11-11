// player-script.js - 多文章支持版本（保留所有原有功能）
document.addEventListener('DOMContentLoaded', function() {
    
    // ===== 新增：多文章配置 =====
    const ARTICLES_CONFIG_FILE = 'articles.json';
    let articlesConfig = [];
    let currentArticleId = null;
    
    const audioPlayer = document.getElementById('audio-player');
    const titleElement = document.getElementById('article-title');
    const transcriptContainer = document.getElementById('transcript-container');
    const speedControl = document.getElementById('speed-control');
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
    const articleSelect = document.getElementById('article-select'); // 新增

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

    // 逐词高亮相关函数
    function findCurrentWord(currentTime) {
        for (let [wordElement, timeRange] of wordTimeMap.entries()) {
            if (currentTime >= timeRange.start && currentTime < timeRange.end) {
                return { element: wordElement, timeRange: timeRange };
            }
        }
        return null;
    }

    function findNextWord(currentTime) {
        let nextWord = null;
        let minStart = Infinity;
        
        for (let [wordElement, timeRange] of wordTimeMap.entries()) {
            if (timeRange.start > currentTime && timeRange.start < minStart) {
                minStart = timeRange.start;
                nextWord = { element: wordElement, timeRange: timeRange };
            }
        }
        return nextWord;
    }

    function highlightCurrentWord(currentWord, nextWord) {
        // 移除之前的高亮
        if (currentWordElement) {
            currentWordElement.classList.remove('current');
        }
        if (nextWordElement) {
            nextWordElement.classList.remove('next');
        }
        
        // 应用新高亮
        if (currentWord) {
            currentWordElement = currentWord.element;
            currentWordElement.classList.add('current');
        }
        
        if (nextWord) {
            nextWordElement = nextWord.element;
            nextWordElement.classList.add('next');
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

    // ===== 新增：加载文章配置列表 =====
    async function loadArticlesConfig() {
        try {
            const response = await fetch(ARTICLES_CONFIG_FILE);
            if (!response.ok) {
                throw new Error('文章配置文件不存在');
            }
            const config = await response.json();
            articlesConfig = config.articles;
            
            // 填充下拉选择框
            articleSelect.innerHTML = '';
            articlesConfig.forEach(article => {
                const option = document.createElement('option');
                option.value = article.id;
                option.textContent = article.title;
                articleSelect.appendChild(option);
            });
            
            // 获取URL参数或默认第一篇
            const urlParams = new URLSearchParams(window.location.search);
            const articleIdFromUrl = urlParams.get('article') || articlesConfig[0].id;
            currentArticleId = articleIdFromUrl;
            articleSelect.value = currentArticleId;
            
            // 加载选中的文章
            loadArticleById(currentArticleId);
            
        } catch (error) {
            console.error('加载文章配置失败:', error);
            // 回退到单文章模式
            articleSelect.style.display = 'none';
            loadSingleArticle();
        }
    }

    // ===== 新增：根据ID加载文章 =====
    function loadArticleById(articleId) {
        const article = articlesConfig.find(a => a.id === articleId);
        if (!article) {
            console.error('找不到文章:', articleId);
            return;
        }
        
        currentArticleId = articleId;
        
        // 更新URL（不刷新页面）
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('article', articleId);
        window.history.pushState({}, '', newUrl);
        
        // 重置状态
        resetPlayerState();
        
        // 加载文章数据
        loadArticleData(article.dataFile, article.audioFile, article.title);
    }

    // ===== 新增：重置播放器状态 =====
    function resetPlayerState() {
        // 停止播放
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        
        // 重置变量
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
        
        // 重置UI
        loopBtn.classList.remove('active');
        transcriptContainer.innerHTML = '<p style="text-align:center; color:#00ffcc;">加载中...</p>';
        updatePlayPauseButton(false);
        progressFilled.style.width = '0%';
        currentTimeDisplay.textContent = '00:00';
    }

    // ===== 修改：加载文章数据（通用函数） =====
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
                transcriptContainer.innerHTML = ''; // 清空旧内容
                
                data.transcript.forEach((line, index) => {
                    const englishText = line.text.split('\n')[0]; 
                    const words = englishText.match(/[a-zA-Z']+/g); 
                    if (words) {
                        totalWordCount += words.length;
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
                    
                    // 处理逐词高亮
                    if (line.words && line.words.length > 0) {
                        const originalText = document.createElement('span');
                        originalText.className = 'original-text';
                        
                        line.words.forEach((wordData, wordIndex) => {
                            const wordSpan = document.createElement('span');
                            wordSpan.className = 'word-highlight';
                            wordSpan.textContent = wordData.text;
                            wordSpan.dataset.start = wordData.start;
                            wordSpan.dataset.end = wordData.end;
                            
                            // 添加空格（除了第一个单词）
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
                        // 没有单词时间数据
                        const originalText = document.createElement('span');
                        originalText.className = 'original-text';
                        originalText.textContent = line.text;
                        textBlock.appendChild(originalText);
                    }
                    
                    // 添加翻译
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

    // ===== 回退：单文章模式（兼容旧版本） =====
    function loadSingleArticle() {
        const urlParams = new URLSearchParams(window.location.search);
        const articleId = urlParams.get('article') || '1';
        const dataFile = `data/article-${articleId}.json`;
        loadArticleData(dataFile, null, null);
    }

    // ===== 新增：监听文章选择变化 =====
    if (articleSelect) {
        articleSelect.addEventListener('change', function() {
            const selectedId = this.value;
            if (selectedId !== currentArticleId) {
                loadArticleById(selectedId);
            }
        });
    }

    // ===== 以下保持原有功能不变 =====
    
    function updatePlayPauseButton(isPlaying) {
        if (isPlaying) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
        } else {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        }
    }

    // 音频事件
    audioPlayer.addEventListener('loadedmetadata', function() {
        if (audioPlayer.duration) {
            totalTimeDisplay.textContent = formatTime(audioPlayer.duration);
        }
        isAudioLoaded = true;
        checkDataLoaded();
    });

    // 播放/暂停按钮
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
    
    // 上一句
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

    // 下一句
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
            // 最后一句，跳到末尾并暂停
            audioPlayer.currentTime = audioPlayer.duration || 0;
            audioPlayer.pause();
        }
    });
    
    // 进度条点击
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
    
    // 播放速度
    speedControl.addEventListener('change', function() {
        audioPlayer.playbackRate = parseFloat(this.value);
    });

    // 单句循环按钮
    loopBtn.addEventListener('click', function() {
        isLooping = !isLooping;
        loopBtn.classList.toggle('active', isLooping);
        
        if (isLooping) {
            const currentTime = audioPlayer.currentTime;
            currentLoopSentence = findSentenceDataByTime(currentTime);
            
            if (currentLoopSentence) {
                console.log('单句循环已开启，当前循环句子:', currentLoopSentence.index);
                
                if (audioPlayer.paused) {
                    audioPlayer.play();
                }
            }
        } else {
            currentLoopSentence = null;
            console.log('单句循环已关闭');
        }
    });

    // 核心时间更新逻辑
    audioPlayer.addEventListener('timeupdate', function() {
        const currentTime = audioPlayer.currentTime; 
        
        if (!isSeeking) {
            const progress = (currentTime / (audioPlayer.duration || 1)) * 100;
            progressFilled.style.width = progress + '%';
            currentTimeDisplay.textContent = formatTime(currentTime);
        }
        
        // 单句循环逻辑
        if (isLooping && currentLoopSentence && currentLoopSentence.end) {
            if (currentTime >= currentLoopSentence.end - 0.15) {
                isLoopSeeking = true;
                audioPlayer.currentTime = currentLoopSentence.start;
                console.log('单句循环：跳回句子开头');
            }
        }
        
        // 逐词高亮逻辑
        const currentWord = findCurrentWord(currentTime);
        const nextWord = findNextWord(currentTime);
        highlightCurrentWord(currentWord, nextWord);
        
        // 单句播放模式逻辑
        if (currentSentencePlayer) {
            if (currentSentencePlayer.end && currentTime >= currentSentencePlayer.end - 0.1) { 
                audioPlayer.pause(); 
                audioPlayer.currentTime = currentSentencePlayer.start;
                cancelSentencePlayerMode();
            }
        } 
        // 全局播放模式
        else {
            updateHighlightAndButton();
        }
    });
    
    // 进度条拖动状态
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
        if (sentenceData === currentSentencePlayer) {
            // 同一个句子：切换播放/暂停
            if (audioPlayer.paused) {
                sentenceData.playButton.classList.add('paused');
                audioPlayer.play();
            } else {
                audioPlayer.pause();
                sentenceData.playButton.classList.remove('paused');
            }
        } else {
            // 新句子：从头播放
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
    
    // 键盘快捷键
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

    // ===== 启动：尝试加载多文章配置，失败则回退单文章 =====
    loadArticlesConfig();

});