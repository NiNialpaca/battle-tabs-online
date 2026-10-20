def attack_cell(enemy, row, col):

    cell_key = f"{row},{col}"

    # 原本這格已經攻擊過
    if cell_key in enemy["attacks_received"]:
        return (
            False,
            "這格已經攻擊過了。",
            None
        )

    # =====================================================
    # Shield：先把攻擊轉移
    # =====================================================

    if enemy["shield_active"]:

        enemy["shield_active"] = False

        options = [
            (row - 1, col),
            (row + 1, col),
            (row, col - 1),
            (row, col + 1)
        ]

        # 只能轉去合法而且沒有打過的位置
        options = [
            (r, c)
            for r, c in options
            if (
                0 <= r < BOARD_SIZE
                and
                0 <= c < BOARD_SIZE
                and
                f"{r},{c}" not in enemy["attacks_received"]
            )
        ]

        if options:

            row, col = random.choice(options)

            cell_key = f"{row},{col}"

            shield_redirected = True

        else:

            shield_redirected = False

    else:

        shield_redirected = False


    # =====================================================
    # 看「真正落點」有沒有船
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

        enemy["attacks_received"][cell_key] = "miss"

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

    enemy["attacks_received"][cell_key] = "hit"

    if cell_key not in target_ship["hits"]:

        target_ship["hits"].append(
            cell_key
        )


    was_sunk = target_ship["sunk"]


    # 重新檢查所有船
    refresh_sunk_status(enemy)


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


    # =====================================================
    # 普通命中
    # =====================================================

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
