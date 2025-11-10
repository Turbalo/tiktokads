(function refresherOncePerSession(global, doc) {
  'use strict';

  var SESSION_KEY = '__intentRefreshSession';

  try {
    // sessionStorage может быть вырублен или недоступен в некоторых WebView
    var storage = global.sessionStorage;
    if (!storage) {
      return;
    }

    // если уже есть отметка – считаем, что сессия "живая", ничего не делаем
    if (storage.getItem(SESSION_KEY)) {
      return;
    }

    // сессии ещё нет → помечаем и перезагружаем страницу
    storage.setItem(SESSION_KEY, String(Date.now()));

    try {
      // мягкий вариант: добавляем анти-кеш параметр и делаем replace
      var url = new URL(global.location.href);
      url.searchParams.set('_r', Date.now().toString(36));
      global.location.replace(url.toString());
    } catch (e) {
      // если вдруг URL не поддерживается (старые WebView) – fallback
      global.location.reload();
    }

  } catch (err) {
    // если sessionStorage недоступен или что-то пошло не так – просто молча выходим
  }
})(window, document);
