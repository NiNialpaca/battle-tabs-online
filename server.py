
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import random, string, uuid

app = FastAPI()
BASE = Path(__file__).parent
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")

SHIP_DEFS = {
    "destroyer": {"name":"Destroyer","size":2,"cooldown":0},
    "radar": {"name":"Radar Ship","size":3,"cooldown":3},
    "shield": {"name":"Shield Ship","size":3,"cooldown":4},
    "missile": {"name":"Missile Ship","size":4,"cooldown":4},
}
BOARD_SIZE = 10
rooms = {}

@app.get("/")
def root():
    return FileResponse(BASE / "static" / "index.html")

def make_code():
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
        if code not in rooms:
            return code

def make_player(ws):
    return {
        "id": str(uuid.uuid4()),
        "ws": ws,
        "ready": False,
        "ships": [],
        "attacks_received": {},
        "radar_numbers": {},
        "shield_active": False,
    }

def get_player(room, pid):
    for i,p in enumerate(room["players"]):
        if p["id"] == pid:
            return i,p
    return None,None

def valid_setup(ships):
    if len(ships) != 4:
        return False
    seen = set()
    ids = {s.get("id") for s in ships}
    if ids != set(SHIP_DEFS.keys()):
        return False
    for s in ships:
        sid = s.get("id")
        cells = s.get("cells", [])
        if len(cells) != SHIP_DEFS[sid]["size"]:
            return False
        for cell in cells:
            try:
                r,c = map(int, cell.split(","))
            except:
                return False
            if not (0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE):
                return False
            if cell in seen:
                return False
            seen.add(cell)
    return True

def hydrate_ships(ships):
    result=[]
    for s in ships:
        d=SHIP_DEFS[s["id"]]
        result.append({
            "id":s["id"],
            "cells":s["cells"],
            "hits":[],
            "sunk":False,
            "cooldown_remaining":0,
            "cooldown":d["cooldown"],
        })
    return result

def refresh_sunk_status(player):
    """Always recompute sunk status from hit cells so win detection cannot go stale."""
    for ship in player["ships"]:
        ship["sunk"] = len(set(ship["hits"])) >= len(ship["cells"])

def all_sunk(player):
    refresh_sunk_status(player)
    return bool(player["ships"]) and all(s["sunk"] for s in player["ships"])

async def notify_sunk(room, attacker_index, ship_names):
    if not ship_names:
        return

    attacker = room["players"][attacker_index]
    defender = room["players"][1-attacker_index]

    for ship_name in ship_names:
        try:
            await attacker["ws"].send_json({
                "type": "ship_sunk",
                "title": "擊沉戰艦！",
                "message": f"你擊沉了對方的 {ship_name}"
            })
        except:
            pass

        try:
            await defender["ws"].send_json({
                "type": "ship_sunk",
                "title": "戰艦被擊沉！",
                "message": f"你的 {ship_name} 被擊沉了"
            })
        except:
            pass

async def finish_game(room, winner_index, message=""):
    room["phase"] = "finished"
    room["winner"] = winner_index

    for i, p in enumerate(room["players"]):
        try:
            await p["ws"].send_json({
                "type": "game_over",
                "you_won": i == winner_index
            })
        except:
            pass

    await broadcast_state(room, message)

def public_state(room, viewer_index, message=None):
    me = room["players"][viewer_index]
    enemy = room["players"][1-viewer_index]
    phase = room["phase"]
    state = {
        "phase": phase,
        "both_ready": all(p["ready"] for p in room["players"]) if len(room["players"])==2 else False,
    }
    if phase in ("battle","finished"):
        state.update({
            "is_your_turn": room["turn"] == viewer_index and phase=="battle",
            "own_ships": [
                {
                    "id":s["id"],
                    "cells":s["cells"],
                    "sunk":s["sunk"],
                    "cooldown_remaining":s["cooldown_remaining"],
                } for s in me["ships"]
            ],
            "own_attacks": me["attacks_received"],
            "enemy_attacks": enemy["attacks_received"],
            "radar_numbers": enemy["radar_numbers"],
            "message": message or "",
        })
        if phase=="finished":
            state["you_won"] = room["winner"] == viewer_index
    return state

async def broadcast_state(room, message=None):
    for i,p in enumerate(room["players"]):
        try:
            await p["ws"].send_json({"type":"state","state":public_state(room,i,message)})
        except:
            pass

def decrement_cooldowns(player):
    for ship in player["ships"]:
        if ship["cooldown_remaining"] > 0:
            ship["cooldown_remaining"] -= 1

def attack_cell(enemy, row, col):
    k=f"{row},{col}"
    if k in enemy["attacks_received"]:
        return False, "這格已經攻擊過了。", None

    target_ship = None
    for s in enemy["ships"]:
        if k in s["cells"]:
            target_ship=s
            break

    if not target_ship:
        enemy["attacks_received"][k]="miss"
        return True, "MISS！沒有命中。", None

    if enemy["shield_active"]:
        options=[(row-1,col),(row+1,col),(row,col-1),(row,col+1)]
        options=[(r,c) for r,c in options if 0<=r<BOARD_SIZE and 0<=c<BOARD_SIZE and f"{r},{c}" not in enemy["attacks_received"]]
        enemy["shield_active"]=False
        if options:
            r,c=random.choice(options)
            enemy["attacks_received"][f"{r},{c}"]="miss"
            return True, "攻擊被護盾偏移！", None

    enemy["attacks_received"][k]="hit"
    if k not in target_ship["hits"]:
        target_ship["hits"].append(k)

    was_sunk = target_ship["sunk"]
    refresh_sunk_status(enemy)

    if target_ship["sunk"] and not was_sunk:
        ship_name = SHIP_DEFS[target_ship["id"]]["name"]
        return True, f"擊沉 {ship_name}！", ship_name

    return True, "HIT！命中敵艦。", None

async def end_turn(room, acting_index, message):
    actor=room["players"][acting_index]
    enemy=room["players"][1-acting_index]

    refresh_sunk_status(enemy)

    if all_sunk(enemy):
        await finish_game(room, acting_index, message)
        return

    decrement_cooldowns(actor)
    room["turn"]=1-acting_index
    await broadcast_state(room, message)

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    current_room = None
    current_pid = None

    try:
        while True:
            msg = await ws.receive_json()
            t = msg.get("type")

            if t=="create_room":
                code=make_code()
                p=make_player(ws)
                rooms[code]={"players":[p],"phase":"waiting","turn":0,"winner":None}
                current_room=code
                current_pid=p["id"]
                await ws.send_json({"type":"room_created","room_code":code,"player_id":p["id"],"player_index":0})
                continue

            if t=="join_room":
                code=msg.get("room_code","").upper()
                room=rooms.get(code)
                if not room:
                    await ws.send_json({"type":"error","message":"找不到這個房間。"})
                    continue
                if len(room["players"])>=2:
                    await ws.send_json({"type":"error","message":"房間已滿。"})
                    continue
                p=make_player(ws)
                room["players"].append(p)
                room["phase"]="setup"
                current_room=code
                current_pid=p["id"]
                await ws.send_json({"type":"joined_room","room_code":code,"player_id":p["id"],"player_index":1})
                await room["players"][0]["ws"].send_json({"type":"opponent_joined"})
                await broadcast_state(room)
                continue

            code=msg.get("room_code")
            pid=msg.get("player_id")
            room=rooms.get(code)
            if not room:
                await ws.send_json({"type":"error","message":"房間不存在。"})
                continue
            idx,player=get_player(room,pid)
            if player is None:
                await ws.send_json({"type":"error","message":"玩家驗證失敗。"})
                continue

            if t=="submit_setup":
                ships=msg.get("ships",[])
                if not valid_setup(ships):
                    await ws.send_json({"type":"error","message":"艦隊配置不合法。"})
                    continue
                player["ships"]=hydrate_ships(ships)
                player["ready"]=True
                if len(room["players"])==2 and all(p["ready"] for p in room["players"]):
                    room["phase"]="battle"
                    room["turn"]=0
                await broadcast_state(room)
                continue

            if room["phase"]!="battle":
                continue

            if room["turn"] != idx:
                await ws.send_json({"type":"error","message":"現在不是你的回合。"})
                continue

            enemy=room["players"][1-idx]

            if t=="attack":
                row,col=msg.get("row"),msg.get("col")
                if not isinstance(row,int) or not isinstance(col,int) or not (0<=row<BOARD_SIZE and 0<=col<BOARD_SIZE):
                    await ws.send_json({"type":"error","message":"無效格子。"})
                    continue
                ok,text,sunk_name=attack_cell(enemy,row,col)
                if not ok:
                    await ws.send_json({"type":"error","message":text})
                    continue
                if sunk_name:
                    await notify_sunk(room, idx, [sunk_name])
                await end_turn(room,idx,text)
                continue

            if t=="use_skill":
                skill=msg.get("skill")
                ship=next((s for s in player["ships"] if s["id"]==skill),None)
                if not ship or ship["sunk"]:
                    await ws.send_json({"type":"error","message":"這個技能不能使用。"})
                    continue
                if ship["cooldown_remaining"]>0:
                    await ws.send_json({"type":"error","message":"技能還在冷卻。"})
                    continue

                if skill=="shield":
                    player["shield_active"]=True
                    ship["cooldown_remaining"]=ship["cooldown"]
                    await end_turn(room,idx,"護盾已啟動。")
                    continue

                row,col=msg.get("row"),msg.get("col")
                if not isinstance(row,int) or not isinstance(col,int) or not (0<=row<BOARD_SIZE and 0<=col<BOARD_SIZE):
                    await ws.send_json({"type":"error","message":"請選擇有效格子。"})
                    continue

                if skill=="radar":
                    count=0
                    for r in range(row-1,row+2):
                        for c in range(col-1,col+2):
                            if 0<=r<BOARD_SIZE and 0<=c<BOARD_SIZE:
                                k=f"{r},{c}"
                                for s in enemy["ships"]:
                                    if k in s["cells"] and k not in s["hits"]:
                                        count+=1
                    enemy["radar_numbers"][f"{row},{col}"]=count
                    ship["cooldown_remaining"]=ship["cooldown"]
                    await end_turn(room,idx,f"雷達掃描完成：中心格顯示 {count}。")
                    continue

                if skill=="missile":
                    targets=[(row,col),(row-1,col),(row+1,col),(row,col-1),(row,col+1)]
                    hits=0
                    sunk_names=[]
                    for r,c in targets:
                        if 0<=r<BOARD_SIZE and 0<=c<BOARD_SIZE:
                            k=f"{r},{c}"
                            if k in enemy["attacks_received"]:
                                continue
                            target_ship=next((s for s in enemy["ships"] if k in s["cells"]),None)
                            ok,_,sunk_name=attack_cell(enemy,r,c)
                            if target_ship and ok:
                                hits+=1
                            if sunk_name and sunk_name not in sunk_names:
                                sunk_names.append(sunk_name)

                    ship["cooldown_remaining"]=ship["cooldown"]

                    if sunk_names:
                        await notify_sunk(room, idx, sunk_names)

                    await end_turn(room,idx,f"飛彈掃射完成，共命中 {hits} 格。")
                    continue

    except WebSocketDisconnect:
        if current_room and current_room in rooms:
            room=rooms[current_room]
            # 房間中有人離線就通知剩下玩家，並移除房間
            for p in room["players"]:
                if p["id"] != current_pid:
                    try:
                        await p["ws"].send_json({"type":"error","message":"對手已離線，房間已關閉。"})
                    except:
                        pass
            rooms.pop(current_room,None)
