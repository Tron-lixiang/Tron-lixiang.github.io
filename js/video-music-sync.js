// Capture media events because play/playing do not bubble. This also covers
// DPlayer videos created later and videos replaced during PJAX navigation.
;(function () {
  const pauseMusic = event => {
    if (!/\/video(?:\/|$)/.test(window.location.pathname)) return
    if (!event.target || event.target.tagName !== 'VIDEO') return

    const players = new Set()
    // music.js declares a top-level const ap (not window.ap).
    if (typeof ap !== 'undefined') players.add(ap)
    document.querySelectorAll('meting-js').forEach(element => {
      if (element.aplayer) players.add(element.aplayer)
    })
    players.forEach(player => {
      if (player && typeof player.pause === 'function' && player.audio && !player.audio.paused) {
        player.pause()
      }
    })
    // Also support APlayer variants that attach their audio element to the DOM.
    document.querySelectorAll('.aplayer audio').forEach(audio => {
      if (!audio.paused) audio.pause()
    })
  }

  document.addEventListener('play', pauseMusic, true)
  document.addEventListener('playing', pauseMusic, true)
})()
