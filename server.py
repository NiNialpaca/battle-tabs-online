from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import random
import string
import uuid

app = FastAPI()

BASE = Path(__file__).parent

app.mount(
    "/static",
    StaticFiles(directory=BASE / "static"),
    name="static"
)

SHIP_DEFS = {
    "destroyer": {
        "name": "Destroyer",
        "size": 2,
        "cooldown": 0
    },
    "radar": {
        "name": "Radar Ship",
        "size": 3,
        "cooldown": 3
    },
    "shield": {
        "name": "Shield Ship",
        "size": 3,
        "cooldown": 4
    },
    "missile": {
        "name": "Missile Ship",
        "size": 4,
        "cooldown": 4
    },
}

BOARD_SIZE = 10
rooms = {}


# =========================================================
# 首頁
# =========================================================

@app.get("/")
def root():
    return FileResponse(
        BASE / "static" / "index.html"
    )


# =========================================================
# 房間工具
# =========================================================

def make_code():
    while True:
        code = "".join(
            random.choices(
                string.ascii_uppercase + string.digits,
                k=4
            )
        )

        if code not in rooms:
            return code


def make_player(ws):
    return {
        "id": str(uuid.uuid4()),
        "ws": ws,
        "connected": True,
        "ready": False,
        "ships": [],
        "attacks_received": {},
        "radar_numbers": {},
        "shield_active": False,
    }


def get_player(room, pid):
    for index, player in enumerate(room["players"]):
        if player["id"] == pid:
            return index, player

    return None, None


# =========================================================
# 部署驗證
# =========================================================

def valid_setup(ships):
    if len(ships) != 4:
        return False

    ids = {
        ship.get("id")
        for ship in ships
    }

    if ids != set(SHIP_DEFS.keys()):
        return False

    seen = set()

    for ship in ships:
        sid = ship.get("id")
        cells = ship.get("cells", [])

        if sid not in SHIP_DEFS:
            return False

        if len(cells) != SHIP_DEFS[sid]["size"]:
            return False

        for cell in cells:
            try:
                row, col = map(
                    int,
                    cell.split(",")
                )
            except Exception:
                return False

            if not (
                0 <= row < BOARD_SIZE
                and
                0 <= col < BOARD_SIZE
            ):
                return False

            if cell in seen:
                return False

            seen.add(cell)

    return True


def hydrate_ships(ships):
    result = []

    for ship in ships:
        ship_def = SHIP_DEFS[ship["id"]]

        result.append({
            "id": ship["id"],
            "cells": ship["cells"],
            "hits": [],
            "sunk": False,
            "cooldown_remaining": 0,
            "cooldown": ship_def["cooldown"],
        })

    return result


# =========================================================
# 擊沉判定
# =========================================================

def refresh_sunk_status(player):
    for ship in player["ships"]:
        ship["sunk"] = (
            len(set(ship["hits"]))
            >=
            len(ship["cells"])
        )


# =========================================================
# DEBUG + 全艦隊死亡判定
# =========================================================

def fleet_destroyed(player):
    if not player["ships"]:
        print("[DEBUG FLEET] no ships")
        return False

    for ship in player["ships"]:

        for cell in ship["cells"]:

            state = player[
                "attacks_received"
            ].get(cell)

            print(
                f"[DEBUG FLEET] "
                f"ship={ship['id']} "
                f"cell={cell} "
                f"state={state}",
                flush=True
            )

            if state != "hit":

                print(
                    "[DEBUG FLEET DESTROYED] False",
                    flush=True
                )

                return False

    print(
        "[DEBUG FLEET DESTROYED] True",
        flush=True
    )

    return True


# =========================================================
# 擊沉通知
# =========================================================

async def notify_sunk(
    room,
    attacker_index,
    ship_names
):
    if not ship_names:
        return

    attacker = room["players"][attacker_index]
    defender = room["players"][1 - attacker_index]

    for ship_name in ship_names:

        if attacker.get("ws") is not None:
            try:
                await attacker["ws"].send_json({
                    "type": "ship_sunk",
                    "title": "擊沉戰艦！",
                    "message": f"你擊沉了對方的 {ship_name}"
                })
            except Exception:
                pass

        if defender.get("ws") is not None:
            try:
                await defender["ws"].send_json({
                    "type": "ship_sunk",
                    "title": "戰艦被擊沉！",
                    "message": f"你的 {ship_name} 被擊沉了"
                })
            except Exception:
                pass


# =========================================================
# 遊戲結束
# =========================================================

async def finish_game(
    room,
    winner_index,
    message=""
):
    print(
        f"[DEBUG GAME OVER] "
        f"winner={winner_index} "
        f"message={message}",
        flush=True
    )

    room["phase"] = "finished"
    room["winner"] = winner_index

    for index, player in enumerate(room["players"]):

        ws = player.get("ws")

        if ws is None:
            continue

        try:
            print(
                f"[DEBUG GAME OVER SEND] "
                f"player={index} "
                f"you_won={index == winner_index}",
                flush=True
            )

            await ws.send_json({
                "type": "game_over",
                "you_won": index == winner_index
            })

        except Exception as e:
            print(
                f"[DEBUG GAME OVER SEND ERROR] "
                f"player={index} "
                f"error={e}",
                flush=True
            )

    await broadcast_state(
        room,
        message
    )


# =========================================================
# 給前端看的狀態
# =========================================================

def public_state(
    room,
    viewer_index,
    message=None
):
    me = room["players"][viewer_index]
    enemy = room["players"][1 - viewer_index]

    phase = room["phase"]

    state = {
        "phase": phase,
        "both_ready": (
            len(room["players"]) == 2
            and
            all(
                player["ready"]
                for player in room["players"]
            )
        )
    }

    if phase in (
        "battle",
        "finished"
    ):
        state.update({
            "is_your_turn": (
                room["turn"] == viewer_index
                and
                phase == "battle"
            ),

            "own_ships": [
                {
                    "id": ship["id"],
                    "cells": ship["cells"],
                    "sunk": ship["sunk"],
                    "cooldown_remaining":
                        ship["cooldown_remaining"],
                }
                for ship in me["ships"]
            ],

            "own_attacks":
                me["attacks_received"],

            "enemy_attacks":
                enemy["attacks_received"],

            "radar_numbers":
                enemy["radar_numbers"],

            "message":
                message or "",
        })

        if phase == "finished":
            state["you_won"] = (
                room["winner"]
                ==
                viewer_index
            )

    return state


# =========================================================
# 廣播狀態
# =========================================================

async def broadcast_state(
    room,
    message=None
):
    for index, player in enumerate(room["players"]):

        ws = player.get("ws")

        if ws is None:
            continue

        try:
            await ws.send_json({
                "type": "state",
                "state": public_state(
                    room,
                    index,
                    message
                )
            })

        except Exception as e:
            print(
                f"[DEBUG BROADCAST ERROR] "
                f"player={index} "
                f"error={e}",
                flush=True
            )


# =========================================================
# 冷卻
# =========================================================

def decrement_cooldowns(player):
    for ship in player["ships"]:

        if ship["cooldown_remaining"] > 0:
            ship["cooldown_remaining"] -= 1


# =========================================================
# 攻擊處理
# =========================================================

def attack_cell(
    enemy,
    row,
    col
):
    cell_key = f"{row},{col}"

    print(
        f"[DEBUG ATTACK START] "
        f"requested={cell_key}",
        flush=True
    )

    # 已攻擊過
    if cell_key in enemy["attacks_received"]:

        print(
            f"[DEBUG ATTACK BLOCKED] "
            f"already attacked={cell_key}",
            flush=True
        )

        return (
            False,
            "這格已經攻擊過了。",
            None
        )

    shield_redirected = False

    # =====================================================
    # Shield
    # =====================================================

    if enemy["shield_active"]:

        enemy["shield_active"] = False

        options = [
            (row - 1, col),
            (row + 1, col),
            (row, col - 1),
            (row, col + 1)
        ]

        options = [
            (r, c)
            for r, c in options
            if (
                0 <= r < BOARD_SIZE
                and
                0 <= c < BOARD_SIZE
                and
                f"{r},{c}"
                not in enemy["attacks_received"]
            )
        ]

        if options:
            row, col = random.choice(options)

            cell_key = f"{row},{col}"

            shield_redirected = True

            print(
                f"[DEBUG SHIELD] "
                f"redirected_to={cell_key}",
                flush=True
            )

    # =====================================================
    # 找真正落點的船
    # =====================================================

    target_ship = None

    for ship in enemy["ships"]:

        if cell_key in ship["cells"]:
            target_ship = ship
            break

    # =====================================================
    # MISS
    # =====================================================

    if target_ship is None:

        enemy[
            "attacks_received"
        ][cell_key] = "miss"

        print(
            f"[DEBUG ATTACK] "
            f"miss cell={cell_key}",
            flush=True
        )

        if shield_redirected:
            return (
                True,
                "攻擊被護盾偏移，沒有命中。",
                None
            )

        return (
            True,
            "MISS！沒有命中。",
            None
        )

    # =====================================================
    # HIT
    # =====================================================

    enemy[
        "attacks_received"
    ][cell_key] = "hit"

    print(
        f"[DEBUG ATTACK] "
        f"hit cell={cell_key} "
        f"ship={target_ship['id']}",
        flush=True
    )

    if cell_key not in target_ship["hits"]:

        target_ship[
            "hits"
        ].append(
            cell_key
        )

    was_sunk = target_ship["sunk"]

    refresh_sunk_status(
        enemy
    )

    print(
        "[DEBUG SHIPS]",
        [
            {
                "id":
                    ship["id"],

                "cells":
                    ship["cells"],

                "hits":
                    ship["hits"],

                "sunk":
                    ship["sunk"]
            }
            for ship in enemy["ships"]
        ],
        flush=True
    )

    # =====================================================
    # 剛剛擊沉
    # =====================================================

    if (
        target_ship["sunk"]
        and
        not was_sunk
    ):
        ship_name = SHIP_DEFS[
            target_ship["id"]
        ]["name"]

        print(
            f"[DEBUG SUNK] "
            f"ship={target_ship['id']}",
            flush=True
        )

        if shield_redirected:
            return (
                True,
                f"攻擊被護盾偏移，但擊沉了 {ship_name}！",
                ship_name
            )

        return (
            True,
            f"擊沉 {ship_name}！",
            ship_name
        )

    if shield_redirected:
        return (
            True,
            "攻擊被護盾偏移，但命中了另一個位置！",
            None
        )

    return (
        True,
        "HIT！命中敵艦。",
        None
    )


# =========================================================
# 結束回合
# =========================================================

async def end_turn(
    room,
    acting_index,
    message
):
    actor = room["players"][acting_index]
    enemy = room["players"][1 - acting_index]

    refresh_sunk_status(
        enemy
    )

    destroyed = fleet_destroyed(
        enemy
    )

    print(
        f"[DEBUG END TURN] "
        f"player={acting_index} "
        f"fleet_destroyed={destroyed}",
        flush=True
    )

    if destroyed:

        print(
            f"[DEBUG FINISH GAME FROM END TURN] "
            f"winner={acting_index}",
            flush=True
        )

        await finish_game(
            room,
            acting_index,
            message
        )

        return

    decrement_cooldowns(
        actor
    )

    room["turn"] = (
        1 - acting_index
    )

    print(
        f"[DEBUG TURN SWITCH] "
        f"next_player={room['turn']}",
        flush=True
    )

    await broadcast_state(
        room,
        message
    )


# =========================================================
# WebSocket
# =========================================================

@app.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket
):
    await ws.accept()

    current_room = None
    current_pid = None

    try:

        while True:

            msg = await ws.receive_json()

            msg_type = msg.get("type")

            print(
                f"[DEBUG MESSAGE] "
                f"type={msg_type}",
                flush=True
            )

            # =================================================
            # 建立房間
            # =================================================

            if msg_type == "create_room":

                code = make_code()

                player = make_player(ws)

                rooms[code] = {
                    "players": [player],
                    "phase": "waiting",
                    "turn": 0,
                    "winner": None,
                }

                current_room = code
                current_pid = player["id"]

                await ws.send_json({
                    "type": "room_created",
                    "room_code": code,
                    "player_id": player["id"],
                    "player_index": 0
                })

                continue

            # =================================================
            # 重連
            # =================================================

            if msg_type == "resume_room":

                code = msg.get(
                    "room_code",
                    ""
                ).upper()

                pid = msg.get(
                    "player_id"
                )

                room = rooms.get(code)

                if not room:

                    await ws.send_json({
                        "type": "error",
                        "message":
                            "原房間已不存在，請重新建立房間。"
                    })

                    continue

                index, player = get_player(
                    room,
                    pid
                )

                if player is None:

                    await ws.send_json({
                        "type": "error",
                        "message":
                            "無法恢復這個玩家。"
                    })

                    continue

                player["ws"] = ws
                player["connected"] = True

                current_room = code
                current_pid = pid

                await ws.send_json({
                    "type": "room_resumed",
                    "room_code": code,
                    "player_id": pid,
                    "player_index": index,
                    "state": public_state(
                        room,
                        index
                    )
                })

                if len(room["players"]) == 2:

                    other = room["players"][
                        1 - index
                    ]

                    if other.get("ws") is not None:
                        try:
                            await other["ws"].send_json({
                                "type":
                                    "connection_notice",
                                "message":
                                    "對手已重新連線"
                            })

                        except Exception:
                            pass

                continue

            # =================================================
            # 加入房間
            # =================================================

            if msg_type == "join_room":

                code = msg.get(
                    "room_code",
                    ""
                ).upper()

                room = rooms.get(code)

                if not room:

                    await ws.send_json({
                        "type": "error",
                        "message":
                            "找不到這個房間。"
                    })

                    continue

                if len(room["players"]) >= 2:

                    await ws.send_json({
                        "type": "error",
                        "message":
                            "房間已滿。"
                    })

                    continue

                player = make_player(
                    ws
                )

                room[
                    "players"
                ].append(
                    player
                )

                room["phase"] = "setup"

                current_room = code
                current_pid = player["id"]

                await ws.send_json({
                    "type":
                        "joined_room",
                    "room_code":
                        code,
                    "player_id":
                        player["id"],
                    "player_index":
                        1
                })

                player1 = room["players"][0]

                if player1.get("ws") is not None:

                    try:
                        await player1["ws"].send_json({
                            "type":
                                "opponent_joined"
                        })

                    except Exception:
                        pass

                await broadcast_state(
                    room
                )

                continue

            # =================================================
            # 驗證房間 / 玩家
            # =================================================

            code = msg.get(
                "room_code"
            )

            pid = msg.get(
                "player_id"
            )

            room = rooms.get(
                code
            )

            if not room:

                await ws.send_json({
                    "type": "error",
                    "message":
                        "房間不存在。"
                })

                continue

            player_index, player = (
                get_player(
                    room,
                    pid
                )
            )

            if player is None:

                await ws.send_json({
                    "type": "error",
                    "message":
                        "玩家驗證失敗。"
                })

                continue

            # =================================================
            # 完成部署
            # =================================================

            if msg_type == "submit_setup":

                ships = msg.get(
                    "ships",
                    []
                )

                if not valid_setup(
                    ships
                ):

                    await ws.send_json({
                        "type": "error",
                        "message":
                            "艦隊配置不合法。"
                    })

                    continue

                player["ships"] = (
                    hydrate_ships(
                        ships
                    )
                )

                player["ready"] = True

                if (
                    len(room["players"]) == 2
                    and
                    all(
                        p["ready"]
                        for p in room["players"]
                    )
                ):
                    room["phase"] = "battle"
                    room["turn"] = 0

                await broadcast_state(
                    room
                )

                continue

            # =================================================
            # 只接受戰鬥操作
            # =================================================

            if room["phase"] != "battle":
                continue

            if room["turn"] != player_index:

                await ws.send_json({
                    "type": "error",
                    "message":
                        "現在不是你的回合。"
                })

                continue

            enemy = room["players"][
                1 - player_index
            ]

            # =================================================
            # 普通攻擊
            # =================================================

            if msg_type == "attack":

                row = msg.get("row")
                col = msg.get("col")

                if (
                    not isinstance(row, int)
                    or
                    not isinstance(col, int)
                    or
                    not (0 <= row < BOARD_SIZE)
                    or
                    not (0 <= col < BOARD_SIZE)
                ):

                    await ws.send_json({
                        "type": "error",
                        "message":
                            "無效格子。"
                    })

                    continue

                ok, text, sunk_name = (
                    attack_cell(
                        enemy,
                        row,
                        col
                    )
                )

                if not ok:

                    await ws.send_json({
                        "type": "error",
                        "message":
                            text
                    })

                    continue

                destroyed = fleet_destroyed(
                    enemy
                )

                print(
                    f"[DEBUG AFTER ATTACK] "
                    f"player={player_index} "
                    f"fleet_destroyed={destroyed}",
                    flush=True
                )

                if destroyed:

                    print(
                        f"[DEBUG FINISH GAME] "
                        f"winner={player_index}",
                        flush=True
                    )

                    await finish_game(
                        room,
                        player_index,
                        text
                    )

                    continue

                if sunk_name:

                    await notify_sunk(
                        room,
                        player_index,
                        [sunk_name]
                    )

                await end_turn(
                    room,
                    player_index,
                    text
                )

                continue

            # =================================================
            # 技能
            # =================================================

            if msg_type == "use_skill":

                skill = msg.get(
                    "skill"
                )

                ship = next(
                    (
                        item
                        for item
                        in player["ships"]
                        if item["id"] == skill
                    ),
                    None
                )

                if (
                    not ship
                    or
                    ship["sunk"]
                ):

                    await ws.send_json({
                        "type": "error",
                        "message":
                            "這個技能不能使用。"
                    })

                    continue

                if ship[
                    "cooldown_remaining"
                ] > 0:

                    await ws.send_json({
                        "type": "error",
                        "message":
                            "技能還在冷卻。"
                    })

                    continue

                # =================================================
                # Shield
                # =================================================

                if skill == "shield":

                    player[
                        "shield_active"
                    ] = True

                    ship[
                        "cooldown_remaining"
                    ] = ship[
                        "cooldown"
                    ]

                    await end_turn(
                        room,
                        player_index,
                        "護盾已啟動。"
                    )

                    continue

                row = msg.get("row")
                col = msg.get("col")

                if (
                    not isinstance(row, int)
                    or
                    not isinstance(col, int)
                    or
                    not (0 <= row < BOARD_SIZE)
                    or
                    not (0 <= col < BOARD_SIZE)
                ):

                    await ws.send_json({
                        "type": "error",
                        "message":
                            "請選擇有效格子。"
                    })

                    continue

                # =================================================
                # Radar
                # =================================================

                if skill == "radar":

                    count = 0

                    for r in range(
                        row - 1,
                        row + 2
                    ):
                        for c in range(
                            col - 1,
                            col + 2
                        ):
                            if not (
                                0 <= r < BOARD_SIZE
                                and
                                0 <= c < BOARD_SIZE
                            ):
                                continue

                            radar_key = (
                                f"{r},{c}"
                            )

                            for target in enemy["ships"]:

                                if (
                                    radar_key
                                    in target["cells"]
                                    and
                                    radar_key
                                    not in target["hits"]
                                ):
                                    count += 1

                    enemy[
                        "radar_numbers"
                    ][
                        f"{row},{col}"
                    ] = count

                    ship[
                        "cooldown_remaining"
                    ] = ship[
                        "cooldown"
                    ]

                    await end_turn(
                        room,
                        player_index,
                        f"雷達掃描完成：中心格顯示 {count}。"
                    )

                    continue

                # =================================================
                # Missile
                # =================================================

                if skill == "missile":

                    targets = [
                        (row, col),
                        (row - 1, col),
                        (row + 1, col),
                        (row, col - 1),
                        (row, col + 1)
                    ]

                    hits = 0
                    sunk_names = []

                    for r, c in targets:

                        if not (
                            0 <= r < BOARD_SIZE
                            and
                            0 <= c < BOARD_SIZE
                        ):
                            continue

                        target_key = (
                            f"{r},{c}"
                        )

                        if (
                            target_key
                            in
                            enemy[
                                "attacks_received"
                            ]
                        ):
                            continue

                        target_ship = next(
                            (
                                target
                                for target
                                in enemy["ships"]
                                if target_key
                                in target["cells"]
                            ),
                            None
                        )

                        ok, _, sunk_name = (
                            attack_cell(
                                enemy,
                                r,
                                c
                            )
                        )

                        if (
                            target_ship
                            and
                            ok
                        ):
                            hits += 1

                        if (
                            sunk_name
                            and
                            sunk_name
                            not in sunk_names
                        ):
                            sunk_names.append(
                                sunk_name
                            )

                    ship[
                        "cooldown_remaining"
                    ] = ship[
                        "cooldown"
                    ]

                    message = (
                        f"飛彈掃射完成，共命中 {hits} 格。"
                    )

                    destroyed = fleet_destroyed(
                        enemy
                    )

                    print(
                        f"[DEBUG AFTER MISSILE] "
                        f"player={player_index} "
                        f"fleet_destroyed={destroyed}",
                        flush=True
                    )

                    if destroyed:

                        print(
                            f"[DEBUG FINISH GAME MISSILE] "
                            f"winner={player_index}",
                            flush=True
                        )

                        await finish_game(
                            room,
                            player_index,
                            message
                        )

                        continue

                    if sunk_names:

                        await notify_sunk(
                            room,
                            player_index,
                            sunk_names
                        )

                    await end_turn(
                        room,
                        player_index,
                        message
                    )

                    continue

    # =========================================================
    # WebSocket 中斷
    # =========================================================

    except WebSocketDisconnect:

        print(
            f"[DEBUG DISCONNECT] "
            f"room={current_room} "
            f"player={current_pid}",
            flush=True
        )

        if (
            current_room
            and
            current_room in rooms
        ):
            room = rooms[
                current_room
            ]

            player_index, player = (
                get_player(
                    room,
                    current_pid
                )
            )

            if player is not None:

                player["ws"] = None
                player["connected"] = False

            for other_player in room["players"]:

                if (
                    other_player["id"]
                    != current_pid
                    and
                    other_player.get("ws")
                    is not None
                ):

                    try:
                        await other_player[
                            "ws"
                        ].send_json({
                            "type":
                                "connection_notice",
                            "message":
                                "對手暫時斷線，等待重新連線…"
                        })

                    except Exception:
                        pass

    except Exception as e:

        print(
            f"[DEBUG SERVER ERROR] "
            f"{type(e).__name__}: {e}",
            flush=True
        )

        raise
