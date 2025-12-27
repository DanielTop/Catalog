// Конфигурация
const CONFIG = {
    username: 'DanielTop',

    // Паттерн URL для Render (имя репо -> URL)
    renderUrl: (repoName) => `https://${repoName.replace(/_/g, '-')}.onrender.com`,

    // Репозитории-исключения (не игры)
    excludeRepos: ['Catalog', 'DanielTop.github.io', 'DanielTop'],

    // Кастомные URL (переопределяют Render URL)
    customUrls: {
        'bomberman-online': 'https://bomberman-production-829f.up.railway.app'
    },

    // Кастомные иконки для игр (по имени репо)
    icons: {
        'stick_online': '⚔️',
        'stick-online': '⚔️',
        'age_of_wars': '🏰',
        'age-of-wars': '🏰',
        'bomberman-online': '💣',
        'zombie-coop': '🧟',
        'zombie_coop': '🧟',
        'default': '🎮'
    },

    // Режим игры (онлайн/вдвоём/соло)
    modes: {
        'stick_online': ['Online'],
        'stick-online': ['Online'],
        'age_of_wars': ['2 Players', 'Local'],
        'age-of-wars': ['2 Players', 'Local'],
        'bomberman-online': ['2 Players', 'Online', 'PvP'],
        'zombie-coop': ['2 Players', 'Online', 'Co-op'],
        'zombie_coop': ['2 Players', 'Online', 'Co-op'],
    },

    // Описания игр (если нет в GitHub)
    descriptions: {
        'stick_online': 'MMO игра с открытым миром в стиле стик-фигур',
        'stick-online': 'MMO игра с открытым миром в стиле стик-фигур',
        'age_of_wars': 'Стратегия с эпохами от каменного века до будущего',
        'age-of-wars': 'Стратегия с эпохами от каменного века до будущего',
    }
};

// Система глобальных лайков (Upstash Redis)
const Likes = {
    REDIS_URL: 'https://innocent-marten-55337.upstash.io',
    REDIS_TOKEN: 'AdgpAAIncDEyNmQ2MjE3MDA2OTY0ZWRiYjU1MDk3NWZkODI1MjBhY3AxNTUzMzc',
    LOCAL_KEY: 'my_liked_games',
    cache: null,

    getMyLikes() {
        return JSON.parse(localStorage.getItem(this.LOCAL_KEY) || '[]');
    },

    setMyLikes(likes) {
        localStorage.setItem(this.LOCAL_KEY, JSON.stringify(likes));
    },

    isLikedByMe(gameId) {
        return this.getMyLikes().includes(gameId);
    },

    async redisCommand(command) {
        const response = await fetch(`${this.REDIS_URL}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.REDIS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(command)
        });
        return response.json();
    },

    async fetchAll() {
        try {
            const result = await this.redisCommand(['HGETALL', 'likes']);
            // Redis возвращает [key1, val1, key2, val2, ...]
            this.cache = {};
            if (result.result && Array.isArray(result.result)) {
                for (let i = 0; i < result.result.length; i += 2) {
                    this.cache[result.result[i]] = parseInt(result.result[i + 1]) || 0;
                }
            }
            return this.cache;
        } catch (error) {
            console.error('Failed to fetch likes:', error);
            this.cache = {};
            return {};
        }
    },

    get(gameId) {
        const count = this.cache?.[gameId] || 0;
        const liked = this.isLikedByMe(gameId);
        return { count, liked };
    },

    async toggle(gameId) {
        const myLikes = this.getMyLikes();
        const isLiked = myLikes.includes(gameId);
        const delta = isLiked ? -1 : 1;

        // Обновляем локально
        if (isLiked) {
            this.setMyLikes(myLikes.filter(id => id !== gameId));
        } else {
            myLikes.push(gameId);
            this.setMyLikes(myLikes);
        }

        // Отправляем в Redis
        try {
            const result = await this.redisCommand(['HINCRBY', 'likes', gameId, delta]);
            const newCount = Math.max(0, result.result || 0);
            if (!this.cache) this.cache = {};
            this.cache[gameId] = newCount;
            return { count: newCount, liked: !isLiked };
        } catch (error) {
            console.error('Failed to save like:', error);
            if (!this.cache) this.cache = {};
            this.cache[gameId] = Math.max(0, (this.cache[gameId] || 0) + delta);
            return { count: this.cache[gameId], liked: !isLiked };
        }
    }
};

// Счётчик заходов в игры (Upstash Redis)
const Views = {
    cache: null,

    async fetchAll() {
        try {
            const result = await Likes.redisCommand(['HGETALL', 'views']);
            this.cache = {};
            if (result.result && Array.isArray(result.result)) {
                for (let i = 0; i < result.result.length; i += 2) {
                    this.cache[result.result[i]] = parseInt(result.result[i + 1]) || 0;
                }
            }
            return this.cache;
        } catch (error) {
            console.error('Failed to fetch views:', error);
            this.cache = {};
            return {};
        }
    },

    get(gameId) {
        return this.cache?.[gameId] || 0;
    },

    async increment(gameId) {
        try {
            const result = await Likes.redisCommand(['HINCRBY', 'views', gameId, 1]);
            if (!this.cache) this.cache = {};
            this.cache[gameId] = result.result || 0;
            return this.cache[gameId];
        } catch (error) {
            console.error('Failed to increment views:', error);
            return this.cache?.[gameId] || 0;
        }
    }
};

// DOM элементы
const gamesGrid = document.getElementById('games-grid');
const loading = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const catalog = document.getElementById('catalog');
const gameContainer = document.getElementById('game-container');
const gameFrame = document.getElementById('game-frame');
const gameTitle = document.getElementById('game-title');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const backBtn = document.getElementById('back-btn');

// Загрузка списка игр с GitHub
async function loadGames() {
    loading.style.display = 'block';
    errorDiv.style.display = 'none';
    gamesGrid.innerHTML = '';

    try {
        // Загружаем лайки, просмотры и репозитории параллельно
        const [likesData, viewsData, reposResponse] = await Promise.all([
            Likes.fetchAll(),
            Views.fetchAll(),
            fetch(`https://api.github.com/users/${CONFIG.username}/repos?sort=updated&per_page=100`)
        ]);

        const response = reposResponse;

        if (!response.ok) {
            throw new Error('Failed to fetch repos');
        }

        const repos = await response.json();

        // Фильтруем репозитории (исключаем не-игровые)
        const gameRepos = repos.filter(repo =>
            !CONFIG.excludeRepos.includes(repo.name) &&
            !repo.fork
        );

        loading.style.display = 'none';

        if (gameRepos.length === 0) {
            showEmptyState();
            return;
        }

        // Отображаем карточки игр из GitHub
        gameRepos.forEach(repo => {
            const game = {
                id: repo.name,
                name: formatGameName(repo.name),
                description: repo.description || CONFIG.descriptions[repo.name] || 'Web game',
                url: CONFIG.customUrls?.[repo.name] || CONFIG.renderUrl(repo.name),
                icon: CONFIG.icons[repo.name] || CONFIG.icons.default,
                modes: CONFIG.modes[repo.name] || ['Solo'],
                created: repo.created_at,
                updated: repo.updated_at
            };

            const card = createGameCard(game);
            gamesGrid.appendChild(card);
        });

    } catch (error) {
        console.error('Error loading games:', error);
        loading.style.display = 'none';
        errorDiv.style.display = 'block';
    }
}

// Обрезать описание до короткого
function truncateDescription(text, maxLength = 60) {
    if (!text || text.length <= maxLength) return text;
    // Обрезаем до первой точки или maxLength символов
    const firstSentence = text.split('.')[0];
    if (firstSentence.length <= maxLength) return firstSentence;
    return text.substring(0, maxLength).trim() + '...';
}

// Создание карточки игры
function createGameCard(game) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.gameId = game.id;

    const modesHtml = game.modes.length > 0
        ? `<div class="game-modes">${game.modes.map(m => `<span class="mode-tag">${m}</span>`).join('')}</div>`
        : '';

    const likeData = Likes.get(game.id);
    const likedClass = likeData.liked ? 'liked' : '';
    const shortDesc = truncateDescription(game.description);
    const viewsCount = Views.get(game.id);

    card.innerHTML = `
        <div class="game-preview">${game.icon}</div>
        <div class="game-info">
            <h3>${game.name}</h3>
            <p class="game-description">${shortDesc}</p>
            ${modesHtml}
            <div class="game-dates">
                <span>📅 ${formatDate(game.created)}</span>
                <span>🔄 ${formatDate(game.updated)}</span>
            </div>
            <div class="game-footer">
                <button class="like-btn ${likedClass}" data-game-id="${game.id}">
                    <span class="like-icon">${likeData.liked ? '❤️' : '🤍'}</span>
                    <span class="like-count">${likeData.count}</span>
                </button>
                <div class="game-meta">
                    <span>👁 ${viewsCount}</span>
                </div>
            </div>
        </div>
    `;

    // Лайк по кнопке
    const likeBtn = card.querySelector('.like-btn');
    likeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        likeBtn.disabled = true;
        const newData = await Likes.toggle(game.id);
        likeBtn.classList.toggle('liked', newData.liked);
        likeBtn.querySelector('.like-icon').textContent = newData.liked ? '❤️' : '🤍';
        likeBtn.querySelector('.like-count').textContent = newData.count;
        likeBtn.disabled = false;
    });

    // Открытие игры по клику на карточку
    card.addEventListener('click', () => openGame(game));

    return card;
}

// Форматирование имени игры (snake_case -> Title Case)
function formatGameName(name) {
    return name
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// Форматирование даты
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short'
    });
}

// Открытие игры
async function openGame(game) {
    catalog.style.display = 'none';
    gameContainer.style.display = 'flex';

    gameTitle.textContent = game.name;
    gameFrame.src = game.url;
    fullscreenBtn.href = game.url;

    // Увеличиваем счётчик просмотров
    Views.increment(game.id);

    history.pushState({ game: game }, '', `?game=${game.id}`);
}

// Закрытие игры
function closeGame() {
    gameContainer.style.display = 'none';
    catalog.style.display = 'block';
    gameFrame.src = '';

    history.pushState({}, '', window.location.pathname);
}

// Пустое состояние
function showEmptyState() {
    gamesGrid.innerHTML = `
        <div class="empty-state">
            <h3>No games yet</h3>
            <p>Add game repositories to GitHub to see them here</p>
        </div>
    `;
}

// Обработка навигации браузера
window.addEventListener('popstate', (event) => {
    if (event.state && event.state.game) {
        openGame(event.state.game);
    } else {
        closeGame();
    }
});

// Обработка URL при загрузке страницы
async function handleInitialUrl() {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('game');

    if (gameId) {
        // Ждём загрузки игр, затем открываем нужную
        await loadGames();
        const card = document.querySelector(`[data-game-id="${gameId}"]`);
        if (card) card.click();
    } else {
        loadGames();
    }
}

// События
backBtn.addEventListener('click', closeGame);

// Инициализация
document.addEventListener('DOMContentLoaded', handleInitialUrl);
