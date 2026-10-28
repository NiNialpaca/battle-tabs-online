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
        "cooldown": 3
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
                string.ascii_uppercase
                +
                string.digits,
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
