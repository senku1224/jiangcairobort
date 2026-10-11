@echo off
chcp 65001 >nul
title 酱菜冒险者公会 · 机器人
cd /d "%~dp0"

echo ============================================
echo   酱菜冒险者公会 · 机器人（本机运行）
echo ============================================
echo.

rem ── 1. 检查 NapCat ─────────────────────────────
tasklist /fi "imagename eq NapCatWinBootMain.exe" 2>nul | find /i "NapCatWinBootMain.exe" >nul
if errorlevel 1 (
  echo [!] 没检测到 NapCat 在运行。
  echo     请先双击启动：E:\迅雷下载\NapCat.Shell\launcher.bat
  echo     如果它弹出二维码，请用机器人小号 3931105615 扫码登录。
  echo     登录成功后回到这个窗口按任意键继续。
  echo.
  pause >nul
) else (
  echo [1/3] NapCat 正在运行。 OK
)

rem ── 2. 结束占着端口的旧机器人（关键）─────────
rem   如果上一次的窗口没关，新程序会因端口被占用而启动失败，
rem   结果就是“看起来更新了、其实跑的还是旧代码”。这里先清掉旧的。
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8790" ^| findstr LISTENING') do (
  echo [2/3] 发现旧机器人进程 PID %%p，正在结束它……
  taskkill /f /pid %%p >nul 2>nul
)

echo [3/3] 启动机器人……
echo.
echo   * 这个窗口不要关，关了机器人就下线。
echo   * 想停止：按 Ctrl+C 或直接关掉本窗口。
echo   * 日志会写到 bot\data\bot.log，排查问题看它就行。
echo.

npm run bot

echo.
echo 机器人已退出。
pause
