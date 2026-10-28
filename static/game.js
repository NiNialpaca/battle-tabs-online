const SHIP_TYPES = [
  {
    id: "destroyer",
    name: "Destroyer",
    size: 2,
    cooldown: 3,
    description: "指定中心格必炸，並隨機轟炸周圍最多 4 格。"
  },
  {
    id: "radar",
    name: "Radar Ship",
    size: 3,
    cooldown: 3,
    description: "掃描 3×3 區域，並攻擊指定的中心格。"
  },
  {
    id: "shield",
    name: "Shield Ship",
    size: 3,
    cooldown: 4,
    description: "啟動後，下一次攻擊會被轉移到鄰近格。"
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
// WebSocket / 房間狀態
// ======================================================

let socket = null;

let roomCode = null;
let playerId = null;
let playerIndex = null;

let reconnectTimer = null;
let intentionalClose = false;


// ======================================================
// 部署狀態
// ======================================================

let setupShips = [];

let setupShipIndex = 0;

let direction = "horizontal";

let setupLocked = false;

// 目前選中的已部署船
let selectedSetupShip = null;

// 拖曳中的船
let draggingShipIndex = null;

// 抓住的是船的哪一格
let dragOffsetRow = 0;
let dragOffsetCol = 0;


// ======================================================
// 戰鬥狀態
// ======================================================

let latestState = null;

let selectedSkill = null;


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
    screen => {

      if (screen) {
        screen.classList.add("hidden");
      }

    }
  );


  if (screens[name]) {

    screens[name].classList.remove(
      "hidden"
    );
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


  return (
    `${protocol}://${location.host}/ws`
  );
}


function connectSocket(onOpen) {

  socket =
    new WebSocket(
      wsUrl()
    );


  socket.onopen =
    () => {

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


  socket.onmessage =
    event => {

      let msg;


      try {

        msg =
          JSON.parse(
            event.data
          );

      } catch (error) {

        console.error(
          "WebSocket JSON error:",
          error
        );

        return;
      }


      handleMessage(
        msg
      );
    };


  socket.onclose =
    () => {

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


  socket.onerror =
    error => {

      console.error(
        "WebSocket error:",
        error
      );
    };
}


// ======================================================
// 自動重連
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

  createRoomBtn.onclick =
    () => {

      const status =
        document.getElementById(
          "lobbyStatus"
        );


      if (status) {

        status.textContent =
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

  joinRoomBtn.onclick =
    () => {

      const input =
        document.getElementById(
          "roomCodeInput"
        );


      if (!input) {
        return;
      }


      const code =
        input.value
          .trim()
          .toUpperCase();


      if (
        code.length !== 4
      ) {

        const status =
          document.getElementById(
            "lobbyStatus"
          );


        if (status) {

          status.textContent =
            "請輸入 4 碼房間代碼。";
        }


        return;
      }


      const status =
        document.getElementById(
          "lobbyStatus"
        );


      if (status) {

        status.textContent =
          "加入房間中...";
      }


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
}


// ======================================================
// 處理 Server 訊息
// ======================================================

function handleMessage(msg) {


  // ====================================================
  // 建房成功
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


    const display =
      document.getElementById(
        "roomCodeDisplay"
      );


    if (display) {

      display.textContent =
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
  // 對手斷線 / 重連
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
  // 擊沉
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
  // 遊戲結束
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
  // State
  // ====================================================

  if (
    msg.type ===
    "state"
  ) {

    latestState =
      msg.state;


    if (
      msg.state.phase
      ===
      "setup"
    ) {

      const status =
        document.getElementById(
          "setupStatus"
        );


      if (status) {

        status.textContent =
          msg.state.both_ready
            ?
            "雙方已準備完成"
            :
            "等待雙方完成部署";
      }
    }


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

  setupLocked = false;

  selectedSetupShip = null;

  draggingShipIndex = null;

  dragOffsetRow = 0;

  dragOffsetCol = 0;

  direction =
    "horizontal";


  updateDirectionButtons();

  renderSetup();
}


// ======================================================
// 基本棋盤工具
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


      cell.type =
        "button";


      cell.className =
        "cell";


      cell.dataset.row =
        row;


      cell.dataset.col =
        col;


      if (onClick) {

        cell.onclick =
          () => {

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
// 找棋盤格
// ======================================================

function getBoardCell(
  board,
  row,
  col
) {

  return [
    ...board.children
  ].find(
    cell => {

      return (
        Number(
          cell.dataset.row
        )
        ===
        row
        &&
        Number(
          cell.dataset.col
        )
        ===
        col
      );
    }
  );
}


// ======================================================
// 建立一艘船的格子
// ======================================================

function buildShipCells(
  size,
  startRow,
  startCol,
  shipDirection
) {

  const cells =
    [];


  for (
    let i = 0;
    i < size;
    i++
  ) {

    const row =
      shipDirection
      ===
      "vertical"
        ?
        startRow + i
        :
        startRow;


    const col =
      shipDirection
      ===
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
// 判斷已放船方向
// ======================================================

function getPlacedShipDirection(
  ship
) {

  if (
    !ship
    ||
    ship.cells.length < 2
  ) {

    return "horizontal";
  }


  const first =
    ship.cells[0]
      .split(",")
      .map(Number);


  const second =
    ship.cells[1]
      .split(",")
      .map(Number);


  if (
    first[0]
    !==
    second[0]
  ) {

    return "vertical";
  }


  return "horizontal";
}


// ======================================================
// 碰撞檢查
// ======================================================

function hasSetupCollision(
  testCells,
  ignoredShipIndex = null
) {

  const occupied =
    new Set();


  setupShips.forEach(
    (
      ship,
      index
    ) => {

      if (
        index
        ===
        ignoredShipIndex
      ) {

        return;
      }


      ship.cells.forEach(
        cell => {

          occupied.add(
            cell
          );
        }
      );
    }
  );


  return testCells.some(
    cell =>
      occupied.has(
        cell
      )
  );
}


// ======================================================
// 部署畫面
// ======================================================

function renderSetup() {

  const board =
    document.getElementById(
      "setupBoard"
    );


  if (!board) {
    return;
  }


  // ====================================================
  // 先畫空棋盤
  // ====================================================

  renderBoard(
    board,
    tryPlaceShip
  );


  // ====================================================
  // 顯示所有船
  // ====================================================

  setupShips.forEach(
    (
      ship,
      shipIndex
    ) => {

      ship.cells.forEach(
        cellKey => {

          const [
            row,
            col
          ] =
            cellKey
              .split(",")
              .map(Number);


          const cell =
            getBoardCell(
              board,
              row,
              col
            );


          if (!cell) {
            return;
          }


          cell.classList.add(
            "ship"
          );


          if (
            selectedSetupShip
            ===
            shipIndex
          ) {

            cell.classList.add(
              "selected-ship"
            );
          }


          // ==================================================
          // 確認部署後不能再調整
          // ==================================================

          if (setupLocked) {

            cell.onclick = null;

            cell.onpointerdown = null;

            return;
          }


          // ==================================================
          // 點一下選船
          // ==================================================

          cell.onclick =
            event => {

              event.preventDefault();

              event.stopPropagation();


              selectedSetupShip =
                shipIndex;


              direction =
                getPlacedShipDirection(
                  ship
                );


              updateDirectionButtons();

              renderSetup();
            };


          // ==================================================
          // 開始拖曳
          // ==================================================

          cell.onpointerdown =
            event => {

              if (setupLocked) {
                return;
              }


              event.preventDefault();

              event.stopPropagation();


              selectedSetupShip =
                shipIndex;


              draggingShipIndex =
                shipIndex;


              direction =
                getPlacedShipDirection(
                  ship
                );


              const [
                firstRow,
                firstCol
              ] =
                ship.cells[0]
                  .split(",")
                  .map(Number);


              // 抓住船哪一格
              dragOffsetRow =
                row - firstRow;

              dragOffsetCol =
                col - firstCol;


              updateDirectionButtons();


              document.body.classList.add(
                "dragging-ship"
              );
            };
        }
      );
    }
  );


  // ====================================================
  // 船列表
  // ====================================================

  const list =
    document.getElementById(
      "shipList"
    );


  if (list) {

    list.innerHTML =
      "";


    SHIP_TYPES.forEach(
      (
        shipType,
        index
      ) => {

        const card =
          document.createElement(
            "div"
          );


        card.className =
          "ship-card";


        const placed =
          index
          <
          setupShips.length;


        if (
          index
          ===
          selectedSetupShip
        ) {

          card.classList.add(
            "current"
          );
        }


        let stateText =
          "尚未部署";


        if (placed) {

          stateText =
            setupLocked
              ?
              "已鎖定"
              :
              "已部署，可拖曳調整";
        }


        card.innerHTML = `
          <strong>
            ${shipType.name}
          </strong>

          <span>
            長度 ${shipType.size}
            ｜${shipType.description}
          </span>

          <span>
            ${stateText}
          </span>
        `;


        if (
          placed
          &&
          !setupLocked
        ) {

          card.onclick =
            () => {

              selectedSetupShip =
                index;


              direction =
                getPlacedShipDirection(
                  setupShips[index]
                );


              updateDirectionButtons();

              renderSetup();
            };
        }


        list.appendChild(
          card
        );
      }
    );
  }


  // ====================================================
  // 水平垂直按鈕
  // ====================================================

  const horizontal =
    document.getElementById(
      "horizontalBtn"
    );


  const vertical =
    document.getElementById(
      "verticalBtn"
    );


  if (horizontal) {

    horizontal.disabled =
      setupLocked;
  }


  if (vertical) {

    vertical.disabled =
      setupLocked;
  }


  // ====================================================
  // 確認部署
  // ====================================================

  const confirm =
    document.getElementById(
      "confirmSetupBtn"
    );


  if (confirm) {

    confirm.disabled =
      setupShips.length
      !==
      SHIP_TYPES.length
      ||
      setupLocked;
  }
}


// ======================================================
// 放新船
// ======================================================

function tryPlaceShip(
  row,
  col
) {

  if (setupLocked) {
    return;
  }


  // 正在拖船，不要同時新增船
  if (
    draggingShipIndex
    !==
    null
  ) {

    return;
  }


  if (
    setupShips.length
    >=
    SHIP_TYPES.length
  ) {

    return;
  }


  const shipType =
    SHIP_TYPES[
      setupShips.length
    ];


  const cells =
    buildShipCells(
      shipType.size,
      row,
      col,
      direction
    );


  if (!cells) {

    alert(
      "超出戰場範圍"
    );

    return;
  }


  if (
    hasSetupCollision(
      cells
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


  setupShipIndex =
    setupShips.length;


  selectedSetupShip =
    setupShips.length - 1;


  direction =
    getPlacedShipDirection(
      setupShips[
        selectedSetupShip
      ]
    );


  updateDirectionButtons();

  renderSetup();
}


// ======================================================
// 移動已放的船
// ======================================================

function moveSetupShip(
  shipIndex,
  startRow,
  startCol
) {

  if (setupLocked) {
    return false;
  }


  const ship =
    setupShips[
      shipIndex
    ];


  if (!ship) {
    return false;
  }


  const definition =
    SHIP_TYPES.find(
      item =>
        item.id
        ===
        ship.id
    );


  if (!definition) {
    return false;
  }


  const shipDirection =
    getPlacedShipDirection(
      ship
    );


  const newCells =
    buildShipCells(
      definition.size,
      startRow,
      startCol,
      shipDirection
    );


  if (!newCells) {

    return false;
  }


  if (
    hasSetupCollision(
      newCells,
      shipIndex
    )
  ) {

    return false;
  }


  ship.cells =
    newCells;


  selectedSetupShip =
    shipIndex;


  return true;
}


// ======================================================
// 全域 pointerup：拖船真正放下
// ======================================================

document.addEventListener(
  "pointerup",
  event => {

    if (
      setupLocked
      ||
      draggingShipIndex
      ===
      null
    ) {

      return;
    }


    const currentDraggingIndex =
      draggingShipIndex;


    draggingShipIndex =
      null;


    document.body.classList.remove(
      "dragging-ship"
    );


    const board =
      document.getElementById(
        "setupBoard"
      );


    if (!board) {

      renderSetup();

      return;
    }


    const element =
      document.elementFromPoint(
        event.clientX,
        event.clientY
      );


    if (!element) {

      renderSetup();

      return;
    }


    const cell =
      element.closest(
        ".cell"
      );


    if (
      !cell
      ||
      !board.contains(
        cell
      )
    ) {

      renderSetup();

      return;
    }


    const targetRow =
      Number(
        cell.dataset.row
      );


    const targetCol =
      Number(
        cell.dataset.col
      );


    moveSetupShip(
      currentDraggingIndex,
      targetRow - dragOffsetRow,
      targetCol - dragOffsetCol
    );


    renderSetup();
  }
);


// 如果滑鼠離開視窗，也結束拖曳
window.addEventListener(
  "blur",
  () => {

    draggingShipIndex =
      null;


    document.body.classList.remove(
      "dragging-ship"
    );
  }
);


// ======================================================
// 旋轉船
// ======================================================

function rotateSetupShip(
  shipIndex,
  newDirection
) {

  if (setupLocked) {
    return false;
  }


  const ship =
    setupShips[
      shipIndex
    ];


  if (!ship) {
    return false;
  }


  const definition =
    SHIP_TYPES.find(
      item =>
        item.id
        ===
        ship.id
    );


  if (!definition) {
    return false;
  }


  const [
    startRow,
    startCol
  ] =
    ship.cells[0]
      .split(",")
      .map(Number);


  const newCells =
    buildShipCells(
      definition.size,
      startRow,
      startCol,
      newDirection
    );


  if (!newCells) {

    alert(
      "這個方向會超出戰場範圍"
    );

    return false;
  }


  if (
    hasSetupCollision(
      newCells,
      shipIndex
    )
  ) {

    alert(
      "旋轉後會撞到其他戰艦"
    );

    return false;
  }


  ship.cells =
    newCells;


  direction =
    newDirection;


  return true;
}


// ======================================================
// 更新方向按鈕
// ======================================================

function updateDirectionButtons() {

  const horizontal =
    document.getElementById(
      "horizontalBtn"
    );


  const vertical =
    document.getElementById(
      "verticalBtn"
    );


  if (horizontal) {

    horizontal.classList.toggle(
      "active",
      direction
      ===
      "horizontal"
    );
  }


  if (vertical) {

    vertical.classList.toggle(
      "active",
      direction
      ===
      "vertical"
    );
  }
}


// ======================================================
// 水平
// ======================================================

const horizontalBtn =
  document.getElementById(
    "horizontalBtn"
  );


if (horizontalBtn) {

  horizontalBtn.onclick =
    () => {

      if (setupLocked) {
        return;
      }


      direction =
        "horizontal";


      if (
        selectedSetupShip
        !==
        null
      ) {

        rotateSetupShip(
          selectedSetupShip,
          "horizontal"
        );
      }


      updateDirectionButtons();

      renderSetup();
    };
}


// ======================================================
// 垂直
// ======================================================

const verticalBtn =
  document.getElementById(
    "verticalBtn"
  );


if (verticalBtn) {

  verticalBtn.onclick =
    () => {

      if (setupLocked) {
        return;
      }


      direction =
        "vertical";


      if (
        selectedSetupShip
        !==
        null
      ) {

        rotateSetupShip(
          selectedSetupShip,
          "vertical"
        );
      }


      updateDirectionButtons();

      renderSetup();
    };
}


// ======================================================
// 確認部署：從這一刻鎖死
// ======================================================

const confirmSetupBtn =
  document.getElementById(
    "confirmSetupBtn"
  );


if (confirmSetupBtn) {

  confirmSetupBtn.onclick =
    () => {

      if (
        setupLocked
        ||
        setupShips.length
        !==
        SHIP_TYPES.length
      ) {

        return;
      }


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


      // =================================================
      // 正式鎖定
      // =================================================

      setupLocked =
        true;


      draggingShipIndex =
        null;


      selectedSetupShip =
        null;


      document.body.classList.remove(
        "dragging-ship"
      );


      const status =
        document.getElementById(
          "setupStatus"
        );


      if (status) {

        status.textContent =
          "部署已確認，不能再調整，等待對手...";
      }


      renderSetup();
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


  const roomDisplay =
    document.getElementById(
      "battleRoomCode"
    );


  if (roomDisplay) {

    roomDisplay.textContent =
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
  // 自己棋盤
  // ====================================================

  const ownShipCells =
    new Set(
      state.own_ships.flatMap(
        ship =>
          ship.cells
      )
    );


  if (ownBoard) {

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
  }


  // ====================================================
  // 敵方棋盤
  // ====================================================

  if (enemyBoard) {

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


        // Radar 中心
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


        cell.disabled =
          !state.is_your_turn;
      }
    );
  }


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
          ship.cooldown_remaining
            >
            0
        );


      button.disabled =
        disabled;


      if (
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

            // Shield 直接啟動
            if (
              ship.id
              ===
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


            // Destroyer / Radar / Missile
            selectedSkill =
              ship.id;


            const status =
              document.getElementById(
                "statusText"
              );


            if (status) {

              status.textContent =
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

  if (
    !latestState
    ||
    !latestState.is_your_turn
  ) {

    return;
  }


  if (
    !socket
    ||
    socket.readyState
      !==
      WebSocket.OPEN
  ) {

    scheduleReconnect();

    return;
  }


  // 技能
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


  // 普攻
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

  const existing =
    document.getElementById(
      "finalGameResult"
    );


  if (existing) {
    return;
  }


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

  title.style.color =
    youWon
      ?
      "#80e0ff"
      :
      "#ff6b6b";


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
}


// ======================================================
// 回首頁
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
