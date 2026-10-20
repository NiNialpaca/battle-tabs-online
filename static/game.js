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
// 遊戲狀態
// ======================================================

let socket = null;

let roomCode = null;

let playerId = null;

let playerIndex = null;


// 部署
let setupShips = [];

let setupShipIndex = 0;

let direction = "horizontal";


// 戰鬥
let latestState = null;

let selectedSkill = null;


// 重新連線
let reconnectTimer = null;

let intentionalClose = false;


// ======================================================
// 畫面
// ======================================================

const screens = {
  lobby:
    document.getElementById("lobbyScreen"),

  waiting:
    document.getElementById("waitingScreen"),

  setup:
    document.getElementById("setupScreen"),

  battle:
    document.getElementById("battleScreen"),

  gameOver:
    document.getElementById("gameOverScreen")
};


function showScreen(name) {

  Object.values(screens).forEach(
    screen =>
      screen.classList.add("hidden")
  );

  screens[name].classList.remove(
    "hidden"
  );
}


// ======================================================
// WebSocket
// ======================================================

function wsUrl() {

  const protocol =
    location.protocol === "https:"
      ? "wss"
      : "ws";

  return (
    `${protocol}://${location.host}/ws`
  );
}


function connectSocket(onOpen) {

  socket = new WebSocket(
    wsUrl()
  );


  socket.onopen = () => {

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

    const msg =
      JSON.parse(
        event.data
      );

    handleMessage(
      msg
    );
  };


  socket.onclose = () => {

    if (intentionalClose) {

      return;
    }


    // 還沒進房間
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


  socket.onerror = () => {

    console.log(
      "WebSocket error"
    );
  };
}


// ======================================================
// 自動重新連線
// ======================================================

function scheduleReconnect() {

  const status =
    document.getElementById(
      "statusText"
    );


  if (status) {

    status.textContent =
      "連線中斷，正在自動重新連線…";
  }


  // 已經在等重連
  if (reconnectTimer) {

    return;
  }


  reconnectTimer =
    setTimeout(
      () => {

        reconnectTimer = null;


        connectSocket(
          () => {

            send(
              "resume_room",
              {
                room_code:
                  roomCode,

                player_id:
                  playerId
              }
            );
          }
        );

      },

      1000
    );
}


// ======================================================
// 傳訊息
// ======================================================

function send(
  type,
  payload = {}
) {

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


  // 遊戲中斷線
  if (
    roomCode
    &&
    playerId
  ) {

    scheduleReconnect();
  }

  else {

    alert(
      "目前沒有連上遊戲伺服器，請重新整理頁面。"
    );
  }


  return false;
}


// ======================================================
// 建立房間
// ======================================================

document
  .getElementById(
    "createRoomBtn"
  )
  .onclick = () => {

    document
      .getElementById(
        "lobbyStatus"
      )
      .textContent =
        "建立房間中...";


    connectSocket(
      () => {

        send(
          "create_room"
        );
      }
    );
  };


// ======================================================
// 加入房間
// ======================================================

document
  .getElementById(
    "joinRoomBtn"
  )
  .onclick = () => {

    const code =
      document
        .getElementById(
          "roomCodeInput"
        )
        .value
        .trim()
        .toUpperCase();


    if (
      code.length !== 4
    ) {

      document
        .getElementById(
          "lobbyStatus"
        )
        .textContent =
          "請輸入 4 碼房間代碼。";

      return;
    }


    document
      .getElementById(
        "lobbyStatus"
      )
      .textContent =
        "加入房間中...";


    connectSocket(
      () => {

        send(
          "join_room",
          {
            room_code:
              code
          }
        );
      }
    );
  };


// ======================================================
// 處理 Server 訊息
// ======================================================

function handleMessage(msg) {


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


    document
      .getElementById(
        "roomCodeDisplay"
      )
      .textContent =
        roomCode;


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
  // 自動重連成功
  // ====================================================

  if (
    msg.type ===
    "room_resumed"
  ) {

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
    }


    else if (
      latestState.phase
      ===
      "finished"
    ) {

      showResultOverlay(
        latestState.you_won
      );
    }


    else if (
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
  // 對手連線狀態
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
        "對手暫時斷線";
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
  // WIN / LOSE
  // ====================================================

  if (
    msg.type ===
    "game_over"
  ) {

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


    // -------------------------
    // Setup
    // -------------------------

    if (
      msg.state.phase
      ===
      "setup"
    ) {

      if (
        !screens.setup
          .classList
          .contains(
            "hidden"
          )
      ) {

        document
          .getElementById(
            "setupStatus"
          )
          .textContent =
            msg.state.both_ready
              ?
              "雙方已準備完成"
              :
              "等待雙方完成部署";
      }
    }


    // -------------------------
    // Battle
    // -------------------------

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


    // -------------------------
    // Finished
    // -------------------------

    if (
      msg.state.phase
      ===
      "finished"
    ) {

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

    const lobbyStatus =
      document.getElementById(
        "lobbyStatus"
      );


    if (
      lobbyStatus
    ) {

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
// 開始部署
// ======================================================

function beginSetup() {

  showScreen(
    "setup"
  );


  document
    .getElementById(
      "roomCodeTop"
    )
    .textContent =
      roomCode;


  document
    .getElementById(
      "playerLabel"
    )
    .textContent =
      `玩家 ${playerIndex + 1}`;


  setupShips = [];

  setupShipIndex = 0;

  direction = "horizontal";


  renderSetup();
}


// ======================================================
// Board 工具
// ======================================================

function key(
  row,
  col
) {

  return (
    `${row},${col}`
  );
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
          () =>
            onClick(
              row,
              col
            );
      }


      container.appendChild(
        cell
      );
    }
  }
}


// ======================================================
// 計算船的位置
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


  // ------------------------
  // 艦隊列表
  // ------------------------

  const list =
    document.getElementById(
      "shipList"
    );


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
        <strong>
          ${ship.name}
        </strong>

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


  document
    .getElementById(
      "confirmSetupBtn"
    )
    .disabled =
      setupShipIndex
      <
      SHIP_TYPES.length;
}


// ======================================================
// 放置戰艦
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
    id:
      shipType.id,

    cells
  });


  setupShipIndex++;


  renderSetup();
}


// ======================================================
// 水平
// ======================================================

document
  .getElementById(
    "horizontalBtn"
  )
  .onclick = () => {

    direction =
      "horizontal";


    document
      .getElementById(
        "horizontalBtn"
      )
      .classList.add(
        "active"
      );


    document
      .getElementById(
        "verticalBtn"
      )
      .classList.remove(
        "active"
      );
  };


// ======================================================
// 垂直
// ======================================================

document
  .getElementById(
    "verticalBtn"
  )
  .onclick = () => {

    direction =
      "vertical";


    document
      .getElementById(
        "verticalBtn"
      )
      .classList.add(
        "active"
      );


    document
      .getElementById(
        "horizontalBtn"
      )
      .classList.remove(
        "active"
      );
  };


// ======================================================
// 完成部署
// ======================================================

document
  .getElementById(
    "confirmSetupBtn"
  )
  .onclick = () => {

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


    document
      .getElementById(
        "confirmSetupBtn"
      )
      .disabled =
        true;


    document
      .getElementById(
        "setupStatus"
      )
      .textContent =
        "已送出部署，等待對手...";
  };


// ======================================================
// Battle 畫面
// ======================================================

function renderBattle() {

  const state =
    latestState;


  if (!state) {

    return;
  }


  document
    .getElementById(
      "battleRoomCode"
    )
    .textContent =
      roomCode;


  document
    .getElementById(
      "turnText"
    )
    .textContent =
      state.is_your_turn
        ?
        "你的回合"
        :
        "對手回合";


  document
    .getElementById(
      "statusText"
    )
    .textContent =
      state.message
      ||
      (
        state.is_your_turn
          ?
          "選擇攻擊格子"
          :
          "等待對手行動"
      );


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
    (
      row,
      col
    ) =>
      onEnemyClick(
        row,
        col
      )
  );


  // ====================================================
  // 自己的船
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
  // 敵方海域
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


      // -------------------------
      // 命中
      // -------------------------

      if (
        attackState ===
        "hit"
      ) {

        cell.classList.add(
          "hit"
        );
      }


      // -------------------------
      // MISS
      // -------------------------

      if (
        attackState ===
        "miss"
      ) {

        cell.classList.add(
          "miss"
        );
      }


      // -------------------------
      // Radar 中心數字
      // -------------------------

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


      // 不是你的回合
      if (
        !state.is_your_turn
      ) {

        cell.disabled =
          true;
      }
    }
  );


  renderSkills(
    state
  );
}


// ======================================================
// Skills
// ======================================================

function renderSkills(state) {

  const list =
    document.getElementById(
      "skillList"
    );


  list.innerHTML =
    "";


  state.own_ships.forEach(
    ship => {

      const definition =
        SHIP_TYPES.find(
          item =>
            item.id ===
            ship.id
        );


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
          ship.id ===
            "destroyer"
          ||
          ship.cooldown_remaining
            >
            0
        );


      button.disabled =
        disabled;


      // ------------------------
      // Destroyer
      // ------------------------

      if (
        ship.id ===
        "destroyer"
      ) {

        button.textContent =
          "被動";
      }


      // ------------------------
      // Cooldown
      // ------------------------

      else if (
        ship.cooldown_remaining
        >
        0
      ) {

        button.textContent =
          `冷卻 ${ship.cooldown_remaining} 回合`;
      }


      // ------------------------
      // Ready
      // ------------------------

      else {

        button.textContent =
          "使用技能";
      }


      // ------------------------
      // 使用技能
      // ------------------------

      if (!disabled) {

        button.onclick =
          () => {


            // =====================
            // Shield
            // =====================

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
            }


            // =====================
            // Radar / Missile
            // =====================

            else {

              selectedSkill =
                ship.id;


              document
                .getElementById(
                  "statusText"
                )
                .textContent =
                  `已選擇 ${definition.name}，請點敵方格子`;


              renderSkills(
                state
              );
            }
          };
      }


      // 顯示目前選中的技能
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

  if (
    !latestState
    ||
    !latestState.is_your_turn
  ) {

    return;
  }


  // WebSocket 掛掉
  if (
    !socket
    ||
    socket.readyState
      !==
      WebSocket.OPEN
  ) {

    document
      .getElementById(
        "statusText"
      )
      .textContent =
        "連線中斷，正在重新連線…";


    scheduleReconnect();

    return;
  }


  // ====================================================
  // 使用技能
  // ====================================================

  if (
    selectedSkill
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
            selectedSkill,

          row,

          col
        }
      );


    if (sent) {

      selectedSkill =
        null;
    }
  }


  // ====================================================
  // 普通攻擊
  // ====================================================

  else {

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
}


// ======================================================
// 擊沉通知 Modal
// ======================================================

function showSunkModal(
  title,
  message
) {

  const modal =
    document.getElementById(
      "sunkModal"
    );


  document
    .getElementById(
      "sunkModalTitle"
    )
    .textContent =
      title;


  document
    .getElementById(
      "sunkModalText"
    )
    .textContent =
      message;


  modal.classList.remove(
    "hidden"
  );
}


document
  .getElementById(
    "closeSunkModalBtn"
  )
  .onclick = () => {

    document
      .getElementById(
        "sunkModal"
      )
      .classList.add(
        "hidden"
      );
  };


// ======================================================
// WIN / LOSE
// ======================================================

function showResultOverlay(
  youWon
) {

  const overlay =
    document.getElementById(
      "resultOverlay"
    );


  const word =
    document.getElementById(
      "resultWord"
    );


  const subtext =
    document.getElementById(
      "resultSubtext"
    );


  if (youWon) {

    word.textContent =
      "WIN";


    word.className =
      "result-word win";


    subtext.textContent =
      "你擊沉了敵方全部戰艦";
  }


  else {

    word.textContent =
      "LOSE";


    word.className =
      "result-word lose";


    subtext.textContent =
      "你的艦隊已全數被擊沉";
  }


  overlay.classList.remove(
    "hidden"
  );
}


// ======================================================
// 回到首頁
// ======================================================

document
  .getElementById(
    "resultBackBtn"
  )
  .onclick = () => {

    intentionalClose =
      true;

    location.reload();
  };


document
  .getElementById(
    "backLobbyBtn"
  )
  .onclick = () => {

    intentionalClose =
      true;

    location.reload();
  };
