const SHIP_TYPES = [
  {
    id: "destroyer",
    name: "Destroyer",
    size: 2,
    cooldown: 0,
    description: "被動戰艦，沒有主動技能。"
  },
  {
    id: "radar",
    name: "Radar Ship",
    size: 3,
    cooldown: 3,
    description: "掃描 3×3 區域，中心格顯示敵艦格數。"
  },
  {
    id: "shield",
    name: "Shield Ship",
    size: 3,
    cooldown: 4,
    description: "啟動後，下一次命中會轉移到鄰近格。"
  },
  {
    id: "missile",
    name: "Missile Ship",
    size: 4,
    cooldown: 4,
    description: "十字攻擊中心與上下左右共 5 格。"
  }
];

const BOARD_SIZE = 10;


// ======================================================
// 全域狀態
// ======================================================

let socket = null;

let roomCode = null;
let playerId = null;
let playerIndex = null;

let setupShips = [];
let setupShipIndex = 0;
let direction = "horizontal";

let latestState = null;
let selectedSkill = null;

let reconnectTimer = null;
let intentionalClose = false;


// ======================================================
// 畫面
// ======================================================

const screens = {
  lobby: document.getElementById("lobbyScreen"),
  waiting: document.getElementById("waitingScreen"),
  setup: document.getElementById("setupScreen"),
  battle: document.getElementById("battleScreen"),
  gameOver: document.getElementById("gameOverScreen")
};


function showScreen(name) {

  Object.values(screens).forEach(screen => {

    if (screen) {
      screen.classList.add("hidden");
    }

  });


  if (screens[name]) {

    screens[name].classList.remove("hidden");

  }
}


// ======================================================
// WebSocket
// ======================================================

function wsUrl() {

  const protocol =
    location.protocol === "https:"
      ? "wss"
      : "ws";

  return `${protocol}://${location.host}/ws`;
}


function connectSocket(onOpen) {

  console.log(
    "[WS] connecting..."
  );


  socket = new WebSocket(
    wsUrl()
  );


  socket.onopen = () => {

    console.log(
      "[WS] connected"
    );


    if (reconnectTimer) {

      clearTimeout(
        reconnectTimer
      );

      reconnectTimer = null;
    }


    if (onOpen) {

      onOpen();
    }
  };


  socket.onmessage = event => {

    console.log(
      "[WS RECEIVE]",
      event.data
    );


    let msg;

    try {

      msg =
        JSON.parse(
          event.data
        );

    } catch (error) {

      console.error(
        "[WS JSON ERROR]",
        error
      );

      return;
    }


    handleMessage(
      msg
    );
  };


  socket.onclose = event => {

    console.log(
      "[WS CLOSED]",
      event.code,
      event.reason
    );


    if (intentionalClose) {

      return;
    }


    if (
      !roomCode
      ||
      !playerId
    ) {

      const status =
        document.getElementById(
          "lobbyStatus"
        );


      if (status) {

        status.textContent =
          "連線中斷，請重新連線。";
      }


      return;
    }


    scheduleReconnect();
  };


  socket.onerror = error => {

    console.error(
      "[WS ERROR]",
      error
    );
  };
}


// ======================================================
// 自動重新連線
// ======================================================

function scheduleReconnect() {

  console.log(
    "[WS] schedule reconnect"
  );


  const status =
    document.getElementById(
      "statusText"
    );


  if (status) {

    status.textContent =
      "連線中斷，正在自動重新連線…";
  }


  if (reconnectTimer) {

    return;
  }


  reconnectTimer =
    setTimeout(
      () => {

        reconnectTimer = null;


        connectSocket(
          () => {

            console.log(
              "[WS] trying resume_room"
            );


            send(
              "resume_room",
              {
                room_code: roomCode,
                player_id: playerId
              }
            );
          }
        );

      },
      1000
    );
}


// ======================================================
// 傳送資料
// ======================================================

function send(
  type,
  payload = {}
) {

  console.log(
    "[WS SEND]",
    type,
    payload
  );


  if (
    socket
    &&
    socket.readyState
      ===
      WebSocket.OPEN
  ) {

    socket.send(
      JSON.stringify({
        type,
        ...payload
      })
    );


    return true;
  }


  console.warn(
    "[WS SEND FAILED] socket not open"
  );


  if (
    roomCode
    &&
    playerId
  ) {

    scheduleReconnect();

  } else {

    alert(
      "目前沒有連上遊戲伺服器，請重新整理頁面。"
    );

  }


  return false;
}


// ======================================================
// 建立房間
// ======================================================

const createRoomBtn =
  document.getElementById(
    "createRoomBtn"
  );


if (createRoomBtn) {

  createRoomBtn.onclick = () => {

    const lobbyStatus =
      document.getElementById(
        "lobbyStatus"
      );


    if (lobbyStatus) {

      lobbyStatus.textContent =
        "建立房間中...";
    }


    connectSocket(
      () => {

        send(
          "create_room"
        );

      }
    );

  };
}


// ======================================================
// 加入房間
// ======================================================

const joinRoomBtn =
  document.getElementById(
    "joinRoomBtn"
  );


if (joinRoomBtn) {

  joinRoomBtn.onclick = () => {

    const input =
      document.getElementById(
        "roomCodeInput"
      );


    const code =
      input
        .value
        .trim()
        .toUpperCase();


    if (
      code.length !== 4
    ) {

      const lobbyStatus =
        document.getElementById(
          "lobbyStatus"
        );


      if (lobbyStatus) {

        lobbyStatus.textContent =
          "請輸入 4 碼房間代碼。";
      }


      return;
    }


    const lobbyStatus =
      document.getElementById(
        "lobbyStatus"
      );


    if (lobbyStatus) {

      lobbyStatus.textContent =
        "加入房間中...";
    }


    connectSocket(
      () => {

        send(
          "join_room",
          {
            room_code: code
          }
        );

      }
    );

  };
}


// ======================================================
// Server 訊息
// ======================================================

function handleMessage(msg) {

  console.log(
    "[HANDLE MESSAGE]",
    msg
  );


  // ====================================================
  // 建立房間成功
  // ====================================================

  if (
    msg.type ===
    "room_created"
  ) {

    roomCode =
      msg.room_code;

    playerId =
      msg.player_id;

    playerIndex =
      msg.player_index;


    const roomCodeDisplay =
      document.getElementById(
        "roomCodeDisplay"
      );


    if (roomCodeDisplay) {

      roomCodeDisplay.textContent =
        roomCode;
    }


    showScreen(
      "waiting"
    );


    return;
  }


  // ====================================================
  // 加入成功
  // ====================================================

  if (
    msg.type ===
    "joined_room"
  ) {

    roomCode =
      msg.room_code;

    playerId =
      msg.player_id;

    playerIndex =
      msg.player_index;


    beginSetup();

    return;
  }


  // ====================================================
  // 對手加入
  // ====================================================

  if (
    msg.type ===
    "opponent_joined"
  ) {

    beginSetup();

    return;
  }


  // ====================================================
  // 重連成功
  // ====================================================

  if (
    msg.type ===
    "room_resumed"
  ) {

    console.log(
      "[ROOM RESUMED]",
      msg
    );


    roomCode =
      msg.room_code;

    playerId =
      msg.player_id;

    playerIndex =
      msg.player_index;

    latestState =
      msg.state;


    if (
      latestState.phase
      ===
      "battle"
    ) {

      showScreen(
        "battle"
      );


      const status =
        document.getElementById(
          "statusText"
        );


      if (status) {

        status.textContent =
          "已重新連線";
      }


      renderBattle();

    } else if (
      latestState.phase
      ===
      "finished"
    ) {

      showResultOverlay(
        latestState.you_won
      );

    } else if (
      latestState.phase
      ===
      "setup"
    ) {

      showScreen(
        "setup"
      );

    }


    return;
  }


  // ====================================================
  // 對手斷線 / 重連訊息
  // ====================================================

  if (
    msg.type ===
    "connection_notice"
  ) {

    const status =
      document.getElementById(
        "statusText"
      );


    if (status) {

      status.textContent =
        msg.message
        ||
        "對手連線狀態改變";
    }


    return;
  }


  // ====================================================
  // 擊沉通知
  // ====================================================

  if (
    msg.type ===
    "ship_sunk"
  ) {

    console.log(
      "[SHIP SUNK]",
      msg
    );


    showSunkModal(
      msg.title
      ||
      "戰艦被擊沉！",

      msg.message
      ||
      ""
    );


    return;
  }


  // ====================================================
  // GAME OVER
  // ====================================================

  if (
    msg.type ===
    "game_over"
  ) {

    console.log(
      "[GAME OVER RECEIVED]",
      msg
    );


    showResultOverlay(
      msg.you_won
    );


    return;
  }


  // ====================================================
  // 遊戲狀態
  // ====================================================

  if (
    msg.type ===
    "state"
  ) {

    latestState =
      msg.state;


    console.log(
      "[STATE UPDATE]",
      latestState
    );


    // -----------------------
    // Setup
    // -----------------------

    if (
      msg.state.phase
      ===
      "setup"
    ) {

      const setupStatus =
        document.getElementById(
          "setupStatus"
        );


      if (
        setupStatus
        &&
        !screens.setup
          .classList
          .contains(
            "hidden"
          )
      ) {

        setupStatus.textContent =
          msg.state.both_ready
            ?
            "雙方已準備完成"
            :
            "等待雙方完成部署";
      }
    }


    // -----------------------
    // Battle
    // -----------------------

    if (
      msg.state.phase
      ===
      "battle"
    ) {

      showScreen(
        "battle"
      );

      renderBattle();
    }


    // -----------------------
    // Finished
    // -----------------------

    if (
      msg.state.phase
      ===
      "finished"
    ) {

      console.log(
        "[STATE FINISHED]",
        msg.state
      );


      showResultOverlay(
        msg.state.you_won
      );
    }


    return;
  }


  // ====================================================
  // Error
  // ====================================================

  if (
    msg.type ===
    "error"
  ) {

    console.error(
      "[SERVER ERROR]",
      msg.message
    );


    const lobbyStatus =
      document.getElementById(
        "lobbyStatus"
      );


    if (lobbyStatus) {

      lobbyStatus.textContent =
        msg.message;
    }


    alert(
      msg.message
    );


    return;
  }
}


// ======================================================
// 部署
// ======================================================

function beginSetup() {

  showScreen(
    "setup"
  );


  const roomCodeTop =
    document.getElementById(
      "roomCodeTop"
    );


  if (roomCodeTop) {

    roomCodeTop.textContent =
      roomCode;
  }


  const playerLabel =
    document.getElementById(
      "playerLabel"
    );


  if (playerLabel) {

    playerLabel.textContent =
      `玩家 ${playerIndex + 1}`;
  }


  setupShips = [];
  setupShipIndex = 0;
  direction = "horizontal";


  renderSetup();
}


// ======================================================
// 棋盤工具
// ======================================================

function key(
  row,
  col
) {

  return `${row},${col}`;
}


function inBounds(
  row,
  col
) {

  return (
    row >= 0
    &&
    row < BOARD_SIZE
    &&
    col >= 0
    &&
    col < BOARD_SIZE
  );
}


function renderBoard(
  container,
  onClick
) {

  if (!container) {

    return;
  }


  container.innerHTML =
    "";


  for (
    let row = 0;
    row < BOARD_SIZE;
    row++
  ) {

    for (
      let col = 0;
      col < BOARD_SIZE;
      col++
    ) {

      const cell =
        document.createElement(
          "button"
        );


      cell.className =
        "cell";


      cell.dataset.row =
        row;

      cell.dataset.col =
        col;


      if (onClick) {

        cell.onclick =
          () => {

            console.log(
              "[CELL CLICK]",
              row,
              col
            );


            onClick(
              row,
              col
            );
          };
      }


      container.appendChild(
        cell
      );
    }
  }
}


// ======================================================
// 船格計算
// ======================================================

function getShipCells(
  ship,
  startRow,
  startCol
) {

  const cells =
    [];


  for (
    let i = 0;
    i < ship.size;
    i++
  ) {

    const row =
      direction ===
      "vertical"
        ?
        startRow + i
        :
        startRow;


    const col =
      direction ===
      "horizontal"
        ?
        startCol + i
        :
        startCol;


    if (
      !inBounds(
        row,
        col
      )
    ) {

      return null;
    }


    cells.push(
      key(
        row,
        col
      )
    );
  }


  return cells;
}


// ======================================================
// 顯示部署
// ======================================================

function renderSetup() {

  const board =
    document.getElementById(
      "setupBoard"
    );


  renderBoard(
    board,
    tryPlaceShip
  );


  const occupied =
    new Set(
      setupShips.flatMap(
        ship =>
          ship.cells
      )
    );


  [
    ...board.children
  ].forEach(
    cell => {

      const cellKey =
        key(
          Number(
            cell.dataset.row
          ),
          Number(
            cell.dataset.col
          )
        );


      if (
        occupied.has(
          cellKey
        )
      ) {

        cell.classList.add(
          "ship"
        );
      }
    }
  );


  const list =
    document.getElementById(
      "shipList"
    );


  if (!list) {

    return;
  }


  list.innerHTML =
    "";


  SHIP_TYPES.forEach(
    (
      ship,
      index
    ) => {

      const card =
        document.createElement(
          "div"
        );


      card.className =
        "ship-card";


      if (
        index ===
        setupShipIndex
      ) {

        card.classList.add(
          "current"
        );
      }


      if (
        index <
        setupShipIndex
      ) {

        card.style.opacity =
          ".5";
      }


      card.innerHTML = `
        <strong>${ship.name}</strong>
        <span>
          長度 ${ship.size}
          ｜${ship.description}
        </span>
      `;


      list.appendChild(
        card
      );
    }
  );


  const confirmSetupBtn =
    document.getElementById(
      "confirmSetupBtn"
    );


  if (confirmSetupBtn) {

    confirmSetupBtn.disabled =
      setupShipIndex
      <
      SHIP_TYPES.length;
  }
}


// ======================================================
// 放船
// ======================================================

function tryPlaceShip(
  row,
  col
) {

  if (
    setupShipIndex
    >=
    SHIP_TYPES.length
  ) {

    return;
  }


  const shipType =
    SHIP_TYPES[
      setupShipIndex
    ];


  const cells =
    getShipCells(
      shipType,
      row,
      col
    );


  if (!cells) {

    alert(
      "超出戰場範圍"
    );

    return;
  }


  const occupied =
    new Set(
      setupShips.flatMap(
        ship =>
          ship.cells
      )
    );


  if (
    cells.some(
      cell =>
        occupied.has(
          cell
        )
    )
  ) {

    alert(
      "戰艦不能重疊"
    );

    return;
  }


  setupShips.push({
    id: shipType.id,
    cells
  });


  setupShipIndex++;


  renderSetup();
}


// ======================================================
// 方向按鈕
// ======================================================

const horizontalBtn =
  document.getElementById(
    "horizontalBtn"
  );


if (horizontalBtn) {

  horizontalBtn.onclick = () => {

    direction =
      "horizontal";


    horizontalBtn.classList.add(
      "active"
    );


    const verticalBtn =
      document.getElementById(
        "verticalBtn"
      );


    if (verticalBtn) {

      verticalBtn.classList.remove(
        "active"
      );
    }
  };
}


const verticalBtn =
  document.getElementById(
    "verticalBtn"
  );


if (verticalBtn) {

  verticalBtn.onclick = () => {

    direction =
      "vertical";


    verticalBtn.classList.add(
      "active"
    );


    const horizontalBtn =
      document.getElementById(
        "horizontalBtn"
      );


    if (horizontalBtn) {

      horizontalBtn.classList.remove(
        "active"
      );
    }
  };
}


// ======================================================
// 完成部署
// ======================================================

const confirmSetupBtn =
  document.getElementById(
    "confirmSetupBtn"
  );


if (confirmSetupBtn) {

  confirmSetupBtn.onclick =
    () => {

      const sent =
        send(
          "submit_setup",
          {
            room_code:
              roomCode,

            player_id:
              playerId,

            ships:
              setupShips
          }
        );


      if (!sent) {

        return;
      }


      confirmSetupBtn.disabled =
        true;


      const setupStatus =
        document.getElementById(
          "setupStatus"
        );


      if (setupStatus) {

        setupStatus.textContent =
          "已送出部署，等待對手...";
      }
    };
}


// ======================================================
// 戰鬥畫面
// ======================================================

function renderBattle() {

  const state =
    latestState;


  if (!state) {

    return;
  }


  console.log(
    "[RENDER BATTLE]",
    state
  );


  const battleRoomCode =
    document.getElementById(
      "battleRoomCode"
    );


  if (battleRoomCode) {

    battleRoomCode.textContent =
      roomCode;
  }


  const turnText =
    document.getElementById(
      "turnText"
    );


  if (turnText) {

    turnText.textContent =
      state.is_your_turn
        ?
        "你的回合"
        :
        "對手回合";
  }


  const statusText =
    document.getElementById(
      "statusText"
    );


  if (statusText) {

    statusText.textContent =
      state.message
      ||
      (
        state.is_your_turn
          ?
          "選擇攻擊格子"
          :
          "等待對手行動"
      );
  }


  const ownBoard =
    document.getElementById(
      "ownBoard"
    );


  const enemyBoard =
    document.getElementById(
      "enemyBoard"
    );


  renderBoard(
    ownBoard,
    null
  );


  renderBoard(
    enemyBoard,
    onEnemyClick
  );


  // ====================================================
  // 自己的棋盤
  // ====================================================

  const ownShipCells =
    new Set(
      state.own_ships.flatMap(
        ship =>
          ship.cells
      )
    );


  [
    ...ownBoard.children
  ].forEach(
    cell => {

      const cellKey =
        key(
          Number(
            cell.dataset.row
          ),
          Number(
            cell.dataset.col
          )
        );


      if (
        ownShipCells.has(
          cellKey
        )
      ) {

        cell.classList.add(
          "ship"
        );
      }


      const attackState =
        state.own_attacks[
          cellKey
        ];


      if (
        attackState ===
        "hit"
      ) {

        cell.classList.add(
          "hit"
        );
      }


      if (
        attackState ===
        "miss"
      ) {

        cell.classList.add(
          "miss"
        );
      }
    }
  );


  // ====================================================
  // 敵方棋盤
  // ====================================================

  [
    ...enemyBoard.children
  ].forEach(
    cell => {

      const cellKey =
        key(
          Number(
            cell.dataset.row
          ),
          Number(
            cell.dataset.col
          )
        );


      const attackState =
        state.enemy_attacks[
          cellKey
        ];


      if (
        attackState ===
        "hit"
      ) {

        cell.classList.add(
          "hit"
        );
      }


      if (
        attackState ===
        "miss"
      ) {

        cell.classList.add(
          "miss"
        );
      }


      // ===============================================
      // Radar 中心
      // ===============================================

      if (
        state.radar_numbers
        &&
        state.radar_numbers[
          cellKey
        ]
        !==
        undefined
      ) {

        cell.classList.add(
          "radar-center"
        );


        cell.textContent =
          state.radar_numbers[
            cellKey
          ];
      }


      // ===============================================
      // 不是你的回合才禁止
      // ===============================================

      cell.disabled =
        !state.is_your_turn;
    }
  );


  renderSkills(
    state
  );
}


// ======================================================
// 技能
// ======================================================

function renderSkills(state) {

  const list =
    document.getElementById(
      "skillList"
    );


  if (!list) {

    return;
  }


  list.innerHTML =
    "";


  state.own_ships.forEach(
    ship => {

      const definition =
        SHIP_TYPES.find(
          item =>
            item.id
            ===
            ship.id
        );


      if (!definition) {

        return;
      }


      const card =
        document.createElement(
          "div"
        );


      card.className =
        "skill-card";


      card.innerHTML = `
        <strong>
          ${definition.name}
          ${
            ship.sunk
              ?
              "（已沉沒）"
              :
              ""
          }
        </strong>

        <span>
          ${definition.description}
        </span>
      `;


      const button =
        document.createElement(
          "button"
        );


      button.className =
        "skill-btn";


      const disabled =
        (
          !state.is_your_turn
          ||
          ship.sunk
          ||
          ship.id
            ===
            "destroyer"
          ||
          ship.cooldown_remaining
            >
            0
        );


      button.disabled =
        disabled;


      if (
        ship.id ===
        "destroyer"
      ) {

        button.textContent =
          "被動";

      } else if (
        ship.cooldown_remaining
        >
        0
      ) {

        button.textContent =
          `冷卻 ${ship.cooldown_remaining} 回合`;

      } else {

        button.textContent =
          "使用技能";

      }


      if (!disabled) {

        button.onclick =
          () => {

            // Shield
            if (
              ship.id ===
              "shield"
            ) {

              const sent =
                send(
                  "use_skill",
                  {
                    room_code:
                      roomCode,

                    player_id:
                      playerId,

                    skill:
                      "shield"
                  }
                );


              if (sent) {

                selectedSkill =
                  null;
              }


              return;
            }


            // Radar / Missile
            selectedSkill =
              ship.id;


            const statusText =
              document.getElementById(
                "statusText"
              );


            if (statusText) {

              statusText.textContent =
                `已選擇 ${definition.name}，請點敵方格子`;
            }


            renderSkills(
              state
            );
          };
      }


      if (
        selectedSkill
        ===
        ship.id
      ) {

        button.classList.add(
          "active"
        );
      }


      card.appendChild(
        button
      );


      list.appendChild(
        card
      );
    }
  );
}


// ======================================================
// 點敵方格子
// ======================================================

function onEnemyClick(
  row,
  col
) {

  console.log(
    "[ENEMY CLICK]",
    row,
    col,
    latestState
  );


  if (!latestState) {

    console.warn(
      "[CLICK BLOCKED] no latestState"
    );

    return;
  }


  if (
    !latestState.is_your_turn
  ) {

    console.warn(
      "[CLICK BLOCKED] not your turn"
    );

    return;
  }


  if (
    !socket
    ||
    socket.readyState
      !==
      WebSocket.OPEN
  ) {

    console.warn(
      "[CLICK BLOCKED] socket disconnected"
    );


    const statusText =
      document.getElementById(
        "statusText"
      );


    if (statusText) {

      statusText.textContent =
        "連線中斷，正在重新連線…";
    }


    scheduleReconnect();

    return;
  }


  // ====================================================
  // 技能攻擊
  // ====================================================

  if (selectedSkill) {

    const sent =
      send(
        "use_skill",
        {
          room_code:
            roomCode,

          player_id:
            playerId,

          skill:
            selectedSkill,

          row,
          col
        }
      );


    if (sent) {

      selectedSkill =
        null;
    }


    return;
  }


  // ====================================================
  // 普通攻擊
  // ====================================================

  send(
    "attack",
    {
      room_code:
        roomCode,

      player_id:
        playerId,

      row,
      col
    }
  );
}


// ======================================================
// 擊沉通知
// ======================================================

function showSunkModal(
  title,
  message
) {

  console.log(
    "[SHOW SUNK MODAL]",
    title,
    message
  );


  const modal =
    document.getElementById(
      "sunkModal"
    );


  const modalTitle =
    document.getElementById(
      "sunkModalTitle"
    );


  const modalText =
    document.getElementById(
      "sunkModalText"
    );


  // 如果原本 modal 存在
  if (
    modal
    &&
    modalTitle
    &&
    modalText
  ) {

    modalTitle.textContent =
      title;

    modalText.textContent =
      message;

    modal.classList.remove(
      "hidden"
    );

    return;
  }


  // 保險
  alert(
    `${title}\n${message}`
  );
}


const closeSunkModalBtn =
  document.getElementById(
    "closeSunkModalBtn"
  );


if (closeSunkModalBtn) {

  closeSunkModalBtn.onclick =
    () => {

      const modal =
        document.getElementById(
          "sunkModal"
        );


      if (modal) {

        modal.classList.add(
          "hidden"
        );
      }

    };
}


// ======================================================
// WIN / LOSE
// ======================================================

function showResultOverlay(
  youWon
) {

  console.log(
    "[SHOW RESULT]",
    youWon
  );


  // 避免重複建立
  const existing =
    document.getElementById(
      "finalGameResult"
    );


  if (existing) {

    return;
  }


  // ====================================================
  // 全螢幕遮罩
  // ====================================================

  const overlay =
    document.createElement(
      "div"
    );


  overlay.id =
    "finalGameResult";


  overlay.style.position =
    "fixed";

  overlay.style.inset =
    "0";

  overlay.style.zIndex =
    "999999";

  overlay.style.background =
    "rgba(2, 6, 12, 0.97)";

  overlay.style.display =
    "flex";

  overlay.style.flexDirection =
    "column";

  overlay.style.alignItems =
    "center";

  overlay.style.justifyContent =
    "center";

  overlay.style.textAlign =
    "center";


  // ====================================================
  // WIN / LOSE
  // ====================================================

  const title =
    document.createElement(
      "div"
    );


  title.textContent =
    youWon
      ?
      "WIN"
      :
      "LOSE";


  title.style.fontSize =
    "clamp(90px, 20vw, 220px)";

  title.style.fontWeight =
    "900";

  title.style.letterSpacing =
    "12px";

  title.style.lineHeight =
    "1";


  title.style.color =
    youWon
      ?
      "#80e0ff"
      :
      "#ff6b6b";


  title.style.textShadow =
    youWon
      ?
      "0 0 45px rgba(81,181,255,.6)"
      :
      "0 0 45px rgba(255,107,107,.5)";


  // ====================================================
  // 說明
  // ====================================================

  const message =
    document.createElement(
      "div"
    );


  message.textContent =
    youWon
      ?
      "你擊沉了敵方全部戰艦"
      :
      "你的艦隊已全數被擊沉";


  message.style.fontSize =
    "clamp(18px, 3vw, 28px)";

  message.style.marginTop =
    "30px";

  message.style.color =
    "#ffffff";


  // ====================================================
  // 回大廳
  // ====================================================

  const button =
    document.createElement(
      "button"
    );


  button.textContent =
    "回到大廳";


  button.style.marginTop =
    "42px";

  button.style.padding =
    "14px 34px";

  button.style.fontSize =
    "18px";

  button.style.fontWeight =
    "800";

  button.style.border =
    "none";

  button.style.borderRadius =
    "12px";

  button.style.cursor =
    "pointer";

  button.style.background =
    "#51b5ff";

  button.style.color =
    "#07101d";


  button.onclick =
    () => {

      intentionalClose =
        true;


      location.reload();
    };


  overlay.appendChild(
    title
  );

  overlay.appendChild(
    message
  );

  overlay.appendChild(
    button
  );


  document.body.appendChild(
    overlay
  );


  console.log(
    "[RESULT OVERLAY CREATED]"
  );
}


// ======================================================
// 原本回大廳按鈕
// ======================================================

const resultBackBtn =
  document.getElementById(
    "resultBackBtn"
  );


if (resultBackBtn) {

  resultBackBtn.onclick =
    () => {

      intentionalClose =
        true;

      location.reload();

    };
}


const backLobbyBtn =
  document.getElementById(
    "backLobbyBtn"
  );


if (backLobbyBtn) {

  backLobbyBtn.onclick =
    () => {

      intentionalClose =
        true;

      location.reload();

    };
}
