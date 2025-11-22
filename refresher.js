(function refresherOncePerSession(global, doc) {
  'use strict';

  var SESSION_KEY = 'intent_done_session';

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
    storage.setItem(SESSION_KEY, '1');

    try {
      // мягкий вариант: добавляем анти-кеш параметр и делаем replace
      var url = new URL(global.location.href);
      url.searchParams.set('_r', Date.now().toString(36));
      try {
        global.location.replace(url.toString());
      } catch (replaceErr) {
        // fallback если location.replace() выбросит исключение
        try {
          global.location.reload();
        } catch (reloadErr) {
          // оба метода не сработали, но мы не можем ничего сделать
        }
      }
    } catch (e) {
      // если вдруг URL не поддерживается (старые WebView) – fallback
      try {
        global.location.reload();
      } catch (reloadErr) {
        // reload тоже не сработал
      }
    }

  } catch (err) {
    // если sessionStorage недоступен или что-то пошло не так – просто молча выходим
  }
})(window, document);
