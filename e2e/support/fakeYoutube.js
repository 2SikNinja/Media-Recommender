window.__yt = { calls: [], state: -1, blockAutoplay: false };
window.YT = { Player: function (el, opts) {
  let ids = []; let index = -1;
  const frame = document.createElement("div"); frame.style.cssText = "width:100%;height:100%;background:#333;color:#aaa;display:flex;align-items:center;justify-content:center;font:14px sans-serif"; frame.textContent = "YouTube video";
  el.replaceWith(frame);
  const log = (name, arg) => window.__yt.calls.push([name, arg]);
  const emit = (s) => { window.__yt.state = s; opts.events.onStateChange({ data: s }); };
  const start = () => {
    if (window.__yt.blockAutoplay) { window.__yt.state = -1; return; }
    emit(3); setTimeout(() => { frame.textContent = "playing " + ids[index]; emit(1); }, 60);
  };
  this.loadPlaylist = (v, i = 0) => { log("loadPlaylist", i); ids = v; index = i; start(); };
  this.nextVideo = () => { log("nextVideo"); index += 1; start(); };
  this.previousVideo = () => { log("previousVideo"); index -= 1; start(); };
  this.playVideo = () => { log("playVideo"); emit(1); };
  this.pauseVideo = () => { log("pauseVideo"); emit(2); };
  this.getPlaylistIndex = () => index;
  this.getPlayerState = () => window.__yt.state;
  this.setVolume = () => {}; this.mute = () => {}; this.unMute = () => {};
  this.destroy = () => log("destroy"); this.stopVideo = () => {};
  setTimeout(() => opts.events.onReady(), 50);
} };
window.__ytSilentSet = (s) => { window.__yt.state = s; };
setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 20);
