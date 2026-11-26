// 站台設定：api 留空時排行榜只記在玩家自己的裝置上；sfx 設為 true 才會下載音效檔（否則用合成音）
// 不讓別的網站把這個遊戲框進去
if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location = window.self.location.href; } catch (e) { /* 跨站時瀏覽器會擋，畫面維持不顯示 */ } }
window.PUMA_CONFIG = { api: 'https://puma-quiz-board.kookisky.workers.dev', version: '20261127d', site: 'https://puma.teanau.net/', sfx: true };
