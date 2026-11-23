/**
 * 10sでぴったり止めろ！ ゲームロジック
 */

(function () {
  'use strict';

  // 定数
  const TARGET_TIME = 10.00;
  const MAX_LIMIT_TIME = 20.00; // 放置対策の最大秒数
  const STORAGE_KEY = 'ten_seconds_game_ranking';

  // 初期ダミーデータ（時計の魔王 1件のみ）
  const DEFAULT_RANKING = [
    {
      date: '2026/01/01 00:00:00',
      name: '時計の魔王',
      time: 9.35,
      diff: 0.65,
      timestamp: new Date('2026-01-01T00:00:00').getTime()
    }
  ];

  // DOM要素
  const displayBox = document.getElementById('displayBox');
  const displayTime = document.getElementById('displayTime');
  const clockIconWrapper = document.getElementById('clockIconWrapper');
  const hallOfFameBadge = document.getElementById('hallOfFameBadge');
  const statusMessage = document.getElementById('statusMessage');
  const actionBtn = document.getElementById('actionBtn');
  const rankingBody = document.getElementById('rankingBody');

  // モーダル関連
  const nicknameModal = document.getElementById('nicknameModal');
  const nicknameForm = document.getElementById('nicknameForm');
  const nicknameInput = document.getElementById('nicknameInput');
  const charCount = document.getElementById('charCount');

  // ゲーム状態
  let state = 'IDLE'; // 'IDLE' | 'RUNNING' | 'STOPPED' | 'WAITING_MODAL'
  let startTime = 0;
  let timerId = null;
  let currentResultTime = 0;
  let latestRankedIndex = -1; // ハイライト用

  // 日時フォーマッター (YYYY/MM/DD HH:mm:ss)
  function formatDateTime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    return `${y}/${m}/${d} ${h}:${min}:${s}`;
  }

  // ランキングの読み込み
  function loadRanking() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
    return [...DEFAULT_RANKING];
  }

  // ランキングの保存
  function saveRanking(rankingList) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rankingList));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
  }

  // ランキングソートロジック
  // 1. 誤差（|タイム - 10.00|）が小さい順
  // 2. 誤差が一致した場合は、新しい日時の記録を上位
  function sortRanking(rankingList) {
    return rankingList.sort((a, b) => {
      const diffA = Math.round(Math.abs(a.time - TARGET_TIME) * 100) / 100;
      const diffB = Math.round(Math.abs(b.time - TARGET_TIME) * 100) / 100;

      if (diffA !== diffB) {
        return diffA - diffB;
      }
      // 誤差が同じ場合は新しいタイムスタンプ順
      return b.timestamp - a.timestamp;
    });
  }

  // ランキングテーブル描画
  function renderRanking(rankingList, highlightIndex = -1) {
    rankingBody.innerHTML = '';

    for (let i = 0; i < 5; i++) {
      const tr = document.createElement('tr');
      const item = rankingList[i];

      if (i === highlightIndex) {
        tr.classList.add('row-highlight');
      }

      if (item) {
        const tdDate = document.createElement('td');
        tdDate.className = 'col-date';
        tdDate.textContent = item.date;

        const tdName = document.createElement('td');
        tdName.className = 'col-name';
        tdName.textContent = item.name;

        const tdTime = document.createElement('td');
        tdTime.className = 'col-time';
        tdTime.textContent = item.time.toFixed(2);

        tr.appendChild(tdDate);
        tr.appendChild(tdName);
        tr.appendChild(tdTime);
      } else {
        // 空枠
        const tdDate = document.createElement('td');
        tdDate.className = 'col-date';
        tdDate.textContent = '---';

        const tdName = document.createElement('td');
        tdName.className = 'col-name';
        tdName.textContent = '---';

        const tdTime = document.createElement('td');
        tdTime.className = 'col-time';
        tdTime.textContent = '---';

        tr.appendChild(tdDate);
        tr.appendChild(tdName);
        tr.appendChild(tdTime);
      }

      rankingBody.appendChild(tr);
    }
  }

  // Top5に入ったか判定する
  function checkIsTop5(scoreTime, currentRanking) {
    if (currentRanking.length < 5) {
      return true;
    }
    const currentDiff = Math.round(Math.abs(scoreTime - TARGET_TIME) * 100) / 100;
    const fifthDiff = Math.round(Math.abs(currentRanking[4].time - TARGET_TIME) * 100) / 100;

    if (currentDiff < fifthDiff) {
      return true;
    }
    // 同タイム（同誤差）の場合、新記録が優先される仕様なので5位と同じ誤差なら入る
    if (currentDiff === fifthDiff) {
      return true;
    }
    return false;
  }

  // ゲームリセット（初期状態へ）
  function resetToInitial() {
    state = 'IDLE';
    displayTime.textContent = '10.00';
    displayTime.style.display = 'block';
    clockIconWrapper.classList.remove('active');
    hallOfFameBadge.classList.remove('show');
    statusMessage.textContent = '';
    statusMessage.className = 'status-message';

    actionBtn.textContent = 'スタート';
    actionBtn.className = 'action-btn btn-start';
  }

  // 計測スタート
  function startMeasurement() {
    state = 'RUNNING';
    statusMessage.textContent = '';
    statusMessage.className = 'status-message';
    hallOfFameBadge.classList.remove('show');

    // 「10.00」を非表示にし、上下に揺れる時計アイコンを表示
    displayTime.style.display = 'none';
    clockIconWrapper.classList.add('active');

    // ボタンを「ストップ」に切り替え
    actionBtn.textContent = 'ストップ';
    actionBtn.className = 'action-btn btn-stop';

    startTime = performance.now();

    // 放置対策（20秒経過チェック）
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed >= MAX_LIMIT_TIME) {
        clearInterval(timerId);
        timerId = null;
        handleTimeout();
      }
    }, 20);
  }

  // 20秒放置時のタイムアウト処理
  function handleTimeout() {
    state = 'STOPPED';
    currentResultTime = MAX_LIMIT_TIME;

    // 時計アイコンを非表示にして「20.00」を表示
    clockIconWrapper.classList.remove('active');
    displayTime.style.display = 'block';
    displayTime.textContent = MAX_LIMIT_TIME.toFixed(2);

    // 文言「時間感覚バグってない。。。？？」を表示
    statusMessage.textContent = '時間感覚バグってない。。。？？';
    statusMessage.className = 'status-message error';

    // ボタンを「もう一度遊ぶ」に
    actionBtn.textContent = 'もう一度遊ぶ';
    actionBtn.className = 'action-btn btn-retry';
  }

  // 通常ストップボタン押下時の処理
  function stopMeasurement() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    const elapsed = (performance.now() - startTime) / 1000;
    // 小数第2位で丸める
    currentResultTime = Math.round(elapsed * 100) / 100;
    state = 'STOPPED';

    // 時計アイコンを非表示にして計測時間を表示
    clockIconWrapper.classList.remove('active');
    displayTime.style.display = 'block';
    displayTime.textContent = currentResultTime.toFixed(2);

    const ranking = loadRanking();
    const isTop5 = checkIsTop5(currentResultTime, ranking);

    if (isTop5) {
      handleHallOfFame();
    } else {
      handleNotRanked();
    }
  }

  // 殿堂入り（Top5）時の演出
  function handleHallOfFame() {
    // 1. 計測時間の右上に赤文字で「殿堂入り！」をポップアップ表示
    hallOfFameBadge.classList.add('show');

    // 2. 2秒後に殿堂入りバッジを非表示にし、ニックネーム入力モーダルを表示
    setTimeout(() => {
      hallOfFameBadge.classList.remove('show');
      openNicknameModal();
    }, 2000);
  }

  // ランク外の処理
  function handleNotRanked() {
    statusMessage.textContent = 'また頑張ってね';
    statusMessage.className = 'status-message';

    actionBtn.textContent = 'もう一度遊ぶ';
    actionBtn.className = 'action-btn btn-retry';
  }

  // ニックネーム入力モーダルを開く
  function openNicknameModal() {
    state = 'WAITING_MODAL';
    nicknameModal.classList.add('active');
    nicknameModal.setAttribute('aria-hidden', 'false');
    nicknameInput.value = '';
    charCount.textContent = '0/10';
    setTimeout(() => {
      nicknameInput.focus();
    }, 100);
  }

  // ニックネーム入力モーダルを閉じる
  function closeNicknameModal() {
    nicknameModal.classList.remove('active');
    nicknameModal.setAttribute('aria-hidden', 'true');
  }

  // ニックネーム確定・ランキング更新
  function submitNickname() {
    let rawName = nicknameInput.value.trim();
    if (!rawName) {
      rawName = 'No Name';
    }
    // 最大10文字
    const name = rawName.slice(0, 10);
    const now = new Date();
    const newRecord = {
      date: formatDateTime(now),
      name: name,
      time: currentResultTime,
      diff: Math.round(Math.abs(currentResultTime - TARGET_TIME) * 100) / 100,
      timestamp: now.getTime()
    };

    let ranking = loadRanking();
    ranking.push(newRecord);
    ranking = sortRanking(ranking);
    const top5 = ranking.slice(0, 5);

    // 新規レコードが何位に入ったかを特定（ハイライト用）
    latestRankedIndex = top5.findIndex(item => item === newRecord || (item.timestamp === newRecord.timestamp && item.name === newRecord.name && item.time === newRecord.time));

    saveRanking(top5);
    renderRanking(top5, latestRankedIndex);

    closeNicknameModal();

    statusMessage.textContent = `★ ${latestRankedIndex + 1}位にランクインしました！`;
    statusMessage.className = 'status-message';

    // ボタンを「もう一度遊ぶ」に
    actionBtn.textContent = 'もう一度遊ぶ';
    actionBtn.className = 'action-btn btn-retry';
    state = 'STOPPED';
  }

  // イベントリスナー設定
  function initEvents() {
    // アクションボタン押下
    actionBtn.addEventListener('click', () => {
      if (state === 'IDLE') {
        startMeasurement();
      } else if (state === 'RUNNING') {
        stopMeasurement();
      } else if (state === 'STOPPED') {
        resetToInitial();
      }
    });

    // ニックネーム入力文字カウント
    nicknameInput.addEventListener('input', () => {
      charCount.textContent = `${nicknameInput.value.length}/10`;
    });

    // ニックネームフォーム送信
    nicknameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitNickname();
    });
  }

  // 初期化
  function init() {
    const ranking = sortRanking(loadRanking());
    saveRanking(ranking.slice(0, 5));
    renderRanking(ranking.slice(0, 5));
    initEvents();
  }

  // DOM構築完了後に実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
