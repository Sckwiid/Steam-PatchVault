(function initRouterModule(global) {
  "use strict";

  var App = global.SteamPatchArchive = global.SteamPatchArchive || {};

  var hasStarted = false;
  var onRouteChange = null;

  function cleanHash(hash) {
    var value = hash || global.location.hash || "#/";
    if (value.indexOf("#") === 0) value = value.slice(1);
    if (!value.startsWith("/")) value = "/" + value;
    var queryIndex = value.indexOf("?");
    if (queryIndex > -1) value = value.slice(0, queryIndex);
    return value;
  }

  function parseRoute(hash) {
    var path = cleanHash(hash);
    if (path === "/" || path === "") {
      return { name: "home", path: "/", params: {} };
    }

    if (path === "/tutorial") {
      return { name: "tutorial", path: path, params: {} };
    }

    if (path === "/tutorial/non-steam") {
      return { name: "tutorial-non-steam", path: path, params: {} };
    }

    if (path === "/about") {
      return { name: "about", path: path, params: {} };
    }

    var gameMatch = path.match(/^\/game\/([^/]+)$/);
    if (gameMatch) {
      return {
        name: "game",
        path: path,
        params: {
          slug: decodeURIComponent(gameMatch[1])
        }
      };
    }

    return { name: "not-found", path: path, params: {} };
  }

  function navigate(path) {
    var target = String(path || "").trim();
    if (!target) return;

    if (!target.startsWith("#")) {
      target = "#" + (target.startsWith("/") ? target : "/" + target);
    }

    if (global.location.hash === target) {
      dispatch();
      return;
    }

    global.location.hash = target;
  }

  function dispatch() {
    if (typeof onRouteChange !== "function") return;
    onRouteChange(parseRoute(global.location.hash));
  }

  function start(handler) {
    onRouteChange = handler;

    if (!hasStarted) {
      global.addEventListener("hashchange", dispatch);
      hasStarted = true;
    }

    if (!global.location.hash) {
      navigate("#/");
    } else {
      dispatch();
    }
  }

  function getCurrentRoute() {
    return parseRoute(global.location.hash);
  }

  App.router = {
    parseRoute: parseRoute,
    navigate: navigate,
    start: start,
    getCurrentRoute: getCurrentRoute
  };
})(window);
