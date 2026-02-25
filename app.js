// ===== Firebase 초기화 =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAvGhAoK94HZNjNc_EURXFdGTZJgvylkiA",
  authDomain: "vibe-todolist-9a065.firebaseapp.com",
  databaseURL: "https://vibe-todolist-9a065-default-rtdb.firebaseio.com",
  projectId: "vibe-todolist-9a065",
  storageBucket: "vibe-todolist-9a065.firebasestorage.app",
  messagingSenderId: "180684807995",
  appId: "1:180684807995:web:08a2e674d49655331de11e",
  measurementId: "G-Q5DL3W0DX5",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Realtime Database 참조
const todosRef = ref(db, 'todos');
const statsRef = ref(db, 'userStats');

// ===== 상태 관리 =====
const STATE_KEY = 'todomaster_state';

const defaultState = {
  todos: [],
  xp: 0,
  level: 1,
  totalCompleted: 0,
  streak: 0,
  lastCompletedDate: null,
  energy: 'medium',
  filter: 'all',
};

let state = loadLocalState();
let pomodoroInterval = null;
let pomodoroSeconds = 25 * 60;
let pomodoroRunning = false;
let pomodoroTodoId = null;
let pomodoroSessions = 0;

// ===== 저장 & 불러오기 =====
function loadLocalState() {
  try {
    const saved = localStorage.getItem(STATE_KEY);
    return saved ? { ...defaultState, ...JSON.parse(saved) } : { ...defaultState };
  } catch {
    return { ...defaultState };
  }
}

function saveLocalState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

async function saveToFirebase() {
  try {
    const { todos, filter, ...stats } = state;
    await Promise.all([
      set(todosRef, todos),
      set(statsRef, {
        xp: stats.xp,
        level: stats.level,
        totalCompleted: stats.totalCompleted,
        streak: stats.streak,
        lastCompletedDate: stats.lastCompletedDate || null,
        energy: stats.energy,
      }),
    ]);
  } catch (err) {
    console.warn('Firebase 저장 실패, localStorage 사용:', err);
  }
}

async function loadFromFirebase() {
  try {
    const [todosSnap, statsSnap] = await Promise.all([
      get(todosRef),
      get(statsRef),
    ]);

    if (todosSnap.exists() || statsSnap.exists()) {
      const todos = todosSnap.exists() ? Object.values(todosSnap.val() || {}) : [];
      const stats = statsSnap.exists() ? statsSnap.val() : {};
      state = { ...defaultState, ...stats, todos, filter: 'all' };
      saveLocalState();
      return true;
    }
    return false;
  } catch (err) {
    console.warn('Firebase 불러오기 실패, localStorage 사용:', err);
    return false;
  }
}

function saveState() {
  saveLocalState();
  saveToFirebase();
}

// ===== XP & 레벨 시스템 =====
const XP_TABLE = { easy: 10, medium: 25, hard: 50 };
const LEVEL_XP = (level) => level * 100;

function addXP(amount, element) {
  state.xp += amount;
  const needed = LEVEL_XP(state.level);

  showXPPopup(amount, element);

  while (state.xp >= needed) {
    state.xp -= needed;
    state.level++;
    showLevelUp(state.level);
  }

  saveState();
  updateUI();
}

function showXPPopup(amount, element) {
  const popup = document.createElement('div');
  popup.className = 'xp-popup';
  popup.textContent = `+${amount} XP`;

  if (element) {
    const rect = element.getBoundingClientRect();
    popup.style.left = `${rect.right + 10}px`;
    popup.style.top = `${rect.top}px`;
  } else {
    popup.style.right = '40px';
    popup.style.top = '40px';
  }

  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1200);
}

function showLevelUp(newLevel) {
  const overlay = document.getElementById('levelup-overlay');
  document.getElementById('new-level').textContent = newLevel;
  overlay.style.display = 'flex';

  const avatars = ['🧙', '⚔️', '🛡️', '👑', '🌟', '🔮', '🐉', '💎', '🏆', '🚀'];
  const avatar = avatars[Math.min(newLevel - 1, avatars.length - 1)];
  document.querySelector('.avatar').textContent = avatar;
}

// ===== 스트릭 관리 =====
function updateStreak() {
  const today = new Date().toDateString();
  if (state.lastCompletedDate === today) return;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (state.lastCompletedDate === yesterday.toDateString()) {
    state.streak++;
  } else if (state.lastCompletedDate !== today) {
    state.streak = 1;
  }

  state.lastCompletedDate = today;
  saveState();
}

// ===== 할일 CRUD =====
window.addTodo = function (text, difficulty, energy) {
  const todo = {
    id: Date.now().toString(),
    text,
    difficulty,
    energy,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  state.todos.unshift(todo);
  saveState();
  updateUI();
};

window.toggleTodo = function (id, element) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;

  todo.completed = !todo.completed;

  if (todo.completed) {
    state.totalCompleted++;
    updateStreak();
    addXP(XP_TABLE[todo.difficulty], element);
  } else {
    state.totalCompleted = Math.max(0, state.totalCompleted - 1);
    state.xp = Math.max(0, state.xp - XP_TABLE[todo.difficulty]);
  }

  saveState();
  updateUI();
};

window.deleteTodo = function (id) {
  state.todos = state.todos.filter((t) => t.id !== id);
  saveState();
  updateUI();
};

// ===== 할일 수정 =====
let editingTodoId = null;

window.startEdit = function (id) {
  editingTodoId = id;
  renderTodos();

  const input = document.querySelector(`.todo-item[data-id="${id}"] .edit-input`);
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
};

window.saveEdit = function (id) {
  const item = document.querySelector(`.todo-item[data-id="${id}"]`);
  if (!item) return;

  const newText = item.querySelector('.edit-input').value.trim();
  const newDifficulty = item.querySelector('.edit-difficulty').value;
  const newEnergy = item.querySelector('.edit-energy').value;

  if (!newText) return;

  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;

  todo.text = newText;
  todo.difficulty = newDifficulty;
  todo.energy = newEnergy;

  editingTodoId = null;
  saveState();
  updateUI();
};

window.cancelEdit = function () {
  editingTodoId = null;
  renderTodos();
};

// ===== 에너지 기반 추천 =====
function getRecommendations() {
  const energy = state.energy;
  const activeTodos = state.todos.filter((t) => !t.completed);

  let recommended;
  const messages = {
    high: '⚡ 에너지가 높을 때 어려운 할일을 처리하세요!',
    medium: '🙂 적당한 난이도의 할일을 추천합니다.',
    low: '😴 가벼운 할일부터 시작해보세요.',
  };

  if (energy === 'high') {
    recommended = activeTodos.sort((a, b) => {
      const order = { hard: 0, medium: 1, easy: 2 };
      return order[a.difficulty] - order[b.difficulty];
    });
  } else if (energy === 'low') {
    recommended = activeTodos.sort((a, b) => {
      const order = { easy: 0, medium: 1, hard: 2 };
      return order[a.difficulty] - order[b.difficulty];
    });
  } else {
    recommended = activeTodos.filter((t) => t.energy === 'medium' || t.difficulty === 'medium');
    if (recommended.length === 0) recommended = activeTodos;
  }

  const banner = document.getElementById('recommendation-banner');
  const recText = document.getElementById('rec-text');

  if (activeTodos.length === 0) {
    recText.textContent = '추천할 할일이 없습니다. 새로운 할일을 추가해보세요!';
  } else {
    recText.textContent = messages[energy];
  }

  banner.style.display = 'flex';

  document.querySelectorAll('.todo-item').forEach((el) => el.classList.remove('recommended'));
  const topIds = recommended.slice(0, 3).map((t) => t.id);
  topIds.forEach((id) => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add('recommended');
  });
}

// ===== 포모도로 타이머 =====
const POMODORO_TOTAL = 25 * 60;

window.openPomodoro = function (todoId) {
  const todo = state.todos.find((t) => t.id === todoId);
  if (!todo) return;

  pomodoroTodoId = todoId;
  pomodoroSeconds = POMODORO_TOTAL;
  pomodoroSessions = 0;
  pomodoroRunning = false;

  document.getElementById('pomodoro-task').textContent = todo.text;
  document.getElementById('pomodoro-overlay').style.display = 'flex';
  document.getElementById('pomo-start').style.display = '';
  document.getElementById('pomo-pause').style.display = 'none';
  updateTimerDisplay();
};

function startPomodoro() {
  if (pomodoroRunning) return;
  pomodoroRunning = true;

  document.getElementById('pomo-start').style.display = 'none';
  document.getElementById('pomo-pause').style.display = '';

  pomodoroInterval = setInterval(() => {
    pomodoroSeconds--;

    if (pomodoroSeconds <= 0) {
      clearInterval(pomodoroInterval);
      pomodoroRunning = false;
      pomodoroSessions++;
      document.getElementById('pomo-session-count').textContent = pomodoroSessions;

      showXPPopup(5, document.querySelector('.pomodoro-modal'));

      if (Notification.permission === 'granted') {
        new Notification('포모도로 완료!', { body: '25분 집중 세션을 완료했습니다. 🎉' });
      }

      pomodoroSeconds = POMODORO_TOTAL;
      document.getElementById('pomo-start').style.display = '';
      document.getElementById('pomo-pause').style.display = 'none';
    }

    updateTimerDisplay();
  }, 1000);
}

function pausePomodoro() {
  clearInterval(pomodoroInterval);
  pomodoroRunning = false;
  document.getElementById('pomo-start').style.display = '';
  document.getElementById('pomo-pause').style.display = 'none';
}

function resetPomodoro() {
  clearInterval(pomodoroInterval);
  pomodoroRunning = false;
  pomodoroSeconds = POMODORO_TOTAL;
  document.getElementById('pomo-start').style.display = '';
  document.getElementById('pomo-pause').style.display = 'none';
  updateTimerDisplay();
}

function closePomodoro() {
  clearInterval(pomodoroInterval);
  pomodoroRunning = false;
  document.getElementById('pomodoro-overlay').style.display = 'none';
}

function updateTimerDisplay() {
  const min = Math.floor(pomodoroSeconds / 60).toString().padStart(2, '0');
  const sec = (pomodoroSeconds % 60).toString().padStart(2, '0');
  document.getElementById('timer-display').textContent = `${min}:${sec}`;

  const circumference = 2 * Math.PI * 90;
  const progress = pomodoroSeconds / POMODORO_TOTAL;
  const offset = circumference * (1 - progress);
  document.getElementById('timer-progress').style.strokeDashoffset = offset;
}

// ===== UI 렌더링 =====
function updateUI() {
  document.getElementById('user-level').textContent = state.level;
  document.getElementById('current-xp').textContent = state.xp;
  const needed = LEVEL_XP(state.level);
  document.getElementById('next-level-xp').textContent = needed;
  document.getElementById('xp-bar').style.width = `${(state.xp / needed) * 100}%`;

  document.getElementById('streak-count').textContent = state.streak;
  document.getElementById('total-completed').textContent = state.totalCompleted;

  const today = new Date();
  const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  document.getElementById('date-display').textContent = today.toLocaleDateString('ko-KR', options);

  renderTodos();
}

function renderTodos() {
  const list = document.getElementById('todo-list');
  const emptyState = document.getElementById('empty-state');

  let todos = [...state.todos];

  if (state.filter === 'active') {
    todos = todos.filter((t) => !t.completed);
  } else if (state.filter === 'completed') {
    todos = todos.filter((t) => t.completed);
  }

  if (todos.length === 0) {
    list.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  list.innerHTML = todos
    .map((todo) => {
      const isEditing = editingTodoId === todo.id;
      const diffBadge = {
        easy: '<span class="badge badge-easy">쉬움</span>',
        medium: '<span class="badge badge-medium">보통</span>',
        hard: '<span class="badge badge-hard">어려움</span>',
      };
      const energyIcon = { low: '😴', medium: '🙂', high: '⚡' };

      if (isEditing) {
        return `
        <li class="todo-item editing" data-id="${todo.id}">
          <input class="edit-input" type="text" value="${escapeHTML(todo.text)}" onkeydown="if(event.key==='Enter')saveEdit('${todo.id}');if(event.key==='Escape')cancelEdit();">
          <select class="edit-difficulty">
            <option value="easy" ${todo.difficulty === 'easy' ? 'selected' : ''}>🟢 쉬움</option>
            <option value="medium" ${todo.difficulty === 'medium' ? 'selected' : ''}>🟡 보통</option>
            <option value="hard" ${todo.difficulty === 'hard' ? 'selected' : ''}>🔴 어려움</option>
          </select>
          <select class="edit-energy">
            <option value="low" ${todo.energy === 'low' ? 'selected' : ''}>😴 낮음</option>
            <option value="medium" ${todo.energy === 'medium' ? 'selected' : ''}>🙂 보통</option>
            <option value="high" ${todo.energy === 'high' ? 'selected' : ''}>⚡ 높음</option>
          </select>
          <div class="edit-actions">
            <button class="todo-action-btn save" onclick="saveEdit('${todo.id}')" title="저장">✓</button>
            <button class="todo-action-btn cancel" onclick="cancelEdit()" title="취소">✕</button>
          </div>
        </li>`;
      }

      return `
      <li class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
        <div class="todo-checkbox ${todo.completed ? 'checked' : ''}" onclick="toggleTodo('${todo.id}', this)"></div>
        <span class="todo-text">${escapeHTML(todo.text)}</span>
        <div class="todo-badges">
          ${diffBadge[todo.difficulty]}
          <span class="badge-energy">${energyIcon[todo.energy]}</span>
        </div>
        <div class="todo-actions">
          <button class="todo-action-btn" onclick="startEdit('${todo.id}')" title="수정">✏️</button>
          <button class="todo-action-btn" onclick="openPomodoro('${todo.id}')" title="포모도로 타이머">🍅</button>
          <button class="todo-action-btn delete" onclick="deleteTodo('${todo.id}')" title="삭제">🗑</button>
        </div>
      </li>`;
    })
    .join('');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== 이벤트 바인딩 =====
async function init() {
  // 알림 권한
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Firebase에서 데이터 불러오기 (실패 시 localStorage 사용)
  await loadFromFirebase();

  // 할일 추가
  document.getElementById('add-btn').addEventListener('click', () => {
    const input = document.getElementById('todo-input');
    const text = input.value.trim();
    if (!text) return;

    const difficulty = document.getElementById('todo-difficulty').value;
    const energy = document.getElementById('todo-energy').value;

    window.addTodo(text, difficulty, energy);
    input.value = '';
    input.focus();
  });

  document.getElementById('todo-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-btn').click();
    }
  });

  // 필터
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderTodos();
    });
  });

  // 에너지 선택
  document.querySelectorAll('.energy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.energy-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.energy = btn.dataset.energy;
      saveState();
    });
  });

  // 에너지 추천
  document.getElementById('recommend-btn').addEventListener('click', getRecommendations);

  // 추천 배너 닫기
  document.getElementById('rec-close').addEventListener('click', () => {
    document.getElementById('recommendation-banner').style.display = 'none';
    document.querySelectorAll('.todo-item').forEach((el) => el.classList.remove('recommended'));
  });

  // 포모도로
  document.getElementById('pomo-start').addEventListener('click', startPomodoro);
  document.getElementById('pomo-pause').addEventListener('click', pausePomodoro);
  document.getElementById('pomo-reset').addEventListener('click', resetPomodoro);
  document.getElementById('pomodoro-close').addEventListener('click', closePomodoro);

  // 레벨업 모달
  document.getElementById('levelup-close').addEventListener('click', () => {
    document.getElementById('levelup-overlay').style.display = 'none';
  });

  // 초기 렌더링
  updateUI();
}

document.addEventListener('DOMContentLoaded', init);
