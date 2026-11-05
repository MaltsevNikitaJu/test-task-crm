# -*- coding: utf-8 -*-
"""Проверка продакшен-деплоя Vercel."""
import sys

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "https://test-task-5m18qwgrk-maltsevnikitajus-projects.vercel.app"

results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(BASE + "/login", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    body = page.locator("body").inner_text()
    ok_login = "Вход" in body and "Регистрация закрыта" in body
    results.append(("✅" if ok_login else "❌") + " экран входа рендерится (env подтянулись)")

    page.fill('input[type="email"]', "boss@test.local")
    page.fill('input[type="password"]', "boss@test.local")
    page.click("form button")
    page.wait_for_timeout(3000)
    body = page.locator("body").inner_text()
    ok_objects = "Объекты" in body and "Северный" in body
    results.append(("✅" if ok_objects else "❌") + " boss входит и видит объекты")
    page.screenshot(path="data/screenshots-ui/10_prod_boss.png")

    page.get_by_role("link", name="ЖК «Северный», корпус 3").first.click()
    page.wait_for_timeout(2000)
    body = page.locator("body").inner_text()
    ok_tasks = "Гидроизоляция" in body or "каркаса" in body
    results.append(("✅" if ok_tasks else "❌") + " карточка объекта с задачами")
    ctx.close()
    browser.close()

with open("prod-results.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(results) + "\n")
print("done")
