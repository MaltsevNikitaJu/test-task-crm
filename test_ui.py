# -*- coding: utf-8 -*-
"""UI-смоук: живые экраны через Playwright (headless). Требует dev-сервер на :5173."""
import os
import sys
import traceback

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
SHOTS = "data/screenshots-ui"
os.makedirs(SHOTS, exist_ok=True)

results = []


def check(name, cond, extra=""):
    results.append(("✅" if cond else "❌") + " " + name + (" — " + extra if extra else ""))


def finish():
    with open("ui-results.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(results) + "\n")
        f.write("ЕСТЬ ПРОВАЛЫ\n" if any(r.startswith("❌") for r in results)
                else "UI-СМОУК ПРОЙДЕН\n")
    print("done")


def login(page, email):
    page.goto(BASE + "/login", wait_until="domcontentloaded")
    page.fill('input[type="email"]', email)
    page.fill('input[type="password"]', email)
    page.click('form button')
    page.wait_for_timeout(3000)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)

        # ---------- постановщик ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        login(page, "boss@test.local")
        page.wait_for_timeout(2000)
        body = page.locator("body").inner_text()
        check("boss: список объектов открыт", "Объекты" in body)
        check("boss: видит все 3 объекта",
              all(s in body for s in ("Северный", "Меркурий", "Школа")))
        page.screenshot(path=f"{SHOTS}/01_boss_objects.png")

        page.get_by_role("link", name="ЖК «Северный», корпус 3").first.click()
        page.wait_for_timeout(2500)
        body = page.locator("body").inner_text()
        check("boss: карточка объекта с задачами",
              "каркаса" in body or "Гидроизоляция" in body)
        page.screenshot(path=f"{SHOTS}/02_boss_object.png")

        page.get_by_role("link", name="Гидроизоляция фундамента").first.click()
        page.wait_for_timeout(2500)
        body = page.locator("body").inner_text()
        check("boss: карточка задачи с историей", "История" in body)
        check("boss: у постановщика нет кнопок исполнителя",
              "Взять в работу" not in body)
        page.screenshot(path=f"{SHOTS}/03_boss_task.png")
        ctx.close()

        # ---------- исполнитель ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        login(page, "worker1@test.local")
        page.wait_for_timeout(2500)
        body = page.locator("body").inner_text()
        check("worker1: попал в «Мои задачи»", "Мои задачи" in body)
        check("worker1: видит свои задачи",
              "Гидроизоляция" in body or "каркаса" in body)
        check("worker1: НЕ видит чужих задач",
              "вентфасада" not in body and "Штукатурка" not in body)
        check("worker1: НЕ видит чужой объект", "Меркурий" not in body)
        page.screenshot(path=f"{SHOTS}/04_worker_my.png")

        btn = page.get_by_role("button", name="Взять в работу").first
        if btn.count() and btn.is_visible():
            btn.click()
            page.wait_for_timeout(2500)
            check("worker1: «Взять в работу» кликается, статус едет", True)
            page.screenshot(path=f"{SHOTS}/05_worker_taken.png")
        else:
            check("worker1: «Взять в работу» кликается", False, "кнопка не найдена")
        ctx.close()
        browser.close()
except Exception:
    results.append("❌ УПАЛ: " + traceback.format_exc(limit=1).splitlines()[-1])
finally:
    finish()
