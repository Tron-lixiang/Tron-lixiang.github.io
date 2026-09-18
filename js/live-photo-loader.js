(function () {
  'use strict'

  const LIVE_PHOTO_SELECTOR = '.js-live-photo'
  // Cache-bust the patched SDK too: it owns the internal video element on
  // mobile and must not be served from an older browser cache.
  const SDK_URL = '/js/livephotoskit.js?v=2'
  const MAX_CONCURRENT_PHOTOS = 2
  const SDK_TIMEOUT = 20000
  const PHOTO_TIMEOUT = 20000
  const VIDEO_READY_TIMEOUT = 30000
  const VIEWPORT_MARGIN = 320

  const boundDetails = new WeakSet()
  const players = new WeakMap()
  const audioTracks = new WeakMap()
  const initializationQueue = []
  const fallbackTargets = new Set()

  let intersectionObserver = null
  let activePlaybackVisibilityObserver = null
  let livePhotosKitPromise = null
  let activeInitializations = 0
  let fallbackFrame = 0
  let fallbackListenersAttached = false
  let pageGeneration = 0
  let activePlayerElement = null
  let activeAudioTrack = null
  let playbackMonitorId = null

  function forEachElement (elements, callback) {
    Array.prototype.forEach.call(elements, callback)
  }

  function getState (element) {
    return element.getAttribute('data-lp-state') || 'idle'
  }

  function setState (element, state) {
    element.setAttribute('data-lp-state', state)
    element.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false')
  }

  function getParentDetails (element) {
    return element.closest('details')
  }

  function canInitialize (element) {
    if (!document.documentElement.contains(element)) return false
    const details = getParentDetails(element)
    return !details || details.open
  }

  function removeScript (script) {
    if (script.parentNode) script.parentNode.removeChild(script)
  }

  function loadLivePhotosKit () {
    if (window.LivePhotosKit) return Promise.resolve(window.LivePhotosKit)
    if (livePhotosKitPromise) return livePhotosKitPromise

    livePhotosKitPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      let settled = false

      const finish = error => {
        if (settled) return
        settled = true
        window.clearTimeout(timeoutId)
        script.onload = null
        script.onerror = null

        if (error) {
          removeScript(script)
          reject(error)
          return
        }

        if (!window.LivePhotosKit) {
          removeScript(script)
          reject(new Error('LivePhotosKit loaded without exposing its API.'))
          return
        }

        resolve(window.LivePhotosKit)
      }

      const timeoutId = window.setTimeout(() => {
        finish(new Error('Timed out while loading LivePhotosKit.'))
      }, SDK_TIMEOUT)

      script.src = SDK_URL
      script.async = true
      script.setAttribute('data-live-photos-kit-sdk', '')
      script.onload = () => finish()
      script.onerror = () => finish(new Error('Failed to load LivePhotosKit.'))
      document.head.appendChild(script)
    }).catch(error => {
      livePhotosKitPromise = null
      throw error
    })

    return livePhotosKitPromise
  }

  function applyPhotoDimensions (element, width, height) {
    const naturalWidth = Number(width)
    const naturalHeight = Number(height)
    if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) return

    // `live` and `live2` explicitly choose a card layout. Recording the
    // source dimensions is useful for diagnostics, but resizing the card to
    // every source photo causes uneven mixed-gallery spacing and letterboxing.
    element.setAttribute('data-lp-aspect-ratio', `${naturalWidth}:${naturalHeight}`)
  }

  function waitForPhoto (player, element) {
    return new Promise((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        window.clearTimeout(timeoutId)
        player.removeEventListener('photoload', handlePhotoLoad, false)
        player.removeEventListener('error', handleError, false)
      }

      const finish = error => {
        if (settled) return
        settled = true
        cleanup()
        error ? reject(error) : resolve()
      }

      const handlePhotoLoad = () => {
        applyPhotoDimensions(element, player.photoWidth, player.photoHeight)
        if (typeof player.updateSize === 'function') player.updateSize(true)
        finish()
      }
      const handleError = event => {
        const detail = event && event.detail
        finish(detail && (detail.error || detail.message) ? (detail.error || new Error(detail.message)) : new Error('Failed to initialize Live Photo.'))
      }

      const timeoutId = window.setTimeout(() => {
        finish(new Error('Timed out while loading the Live Photo preview.'))
      }, PHOTO_TIMEOUT)

      player.addEventListener('photoload', handlePhotoLoad, false)
      player.addEventListener('error', handleError, false)
    })
  }

  function renderFallback (element, error) {
    console.warn('[Live Photo]', error)
    element.innerHTML = ''
    element.classList.add('live-photo__player--error')
    setState(element, 'error')

    return new Promise(resolve => {
      const image = document.createElement('img')
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timeoutId)
        image.onload = null
        image.onerror = null
        resolve()
      }

      const handleImageLoad = () => {
        applyPhotoDimensions(element, image.naturalWidth, image.naturalHeight)
        finish()
      }

      const timeoutId = window.setTimeout(finish, PHOTO_TIMEOUT)
      image.alt = element.getAttribute('data-lp-caption') || 'Live Photo'
      image.loading = 'lazy'
      image.decoding = 'async'
      image.onload = handleImageLoad
      image.onerror = finish
      image.src = element.getAttribute('data-lp-photo')
      element.appendChild(image)
    })
  }

  // A `videoload` event only means that the video resource arrived. Wait until
  // LivePhotosKit has also decoded a renderable frame before exposing the
  // player, otherwise switching from the still image to the video canvas can
  // briefly paint a white frame on slower mobile networks.
  function waitForVideoFrame (player) {
    return new Promise((resolve, reject) => {
      let settled = false
      let checkTimer = null

      const isReady = () => player.canPlay || (player.renderer && player.renderer.isFullyPreparedForPlayback)
      const cleanup = () => {
        window.clearTimeout(timeoutId)
        window.clearInterval(checkTimer)
        player.removeEventListener('videoload', handleVideoLoad, false)
        player.removeEventListener('error', handleError, false)
      }
      const finish = error => {
        if (settled) return
        settled = true
        cleanup()
        error ? reject(error) : resolve()
      }
      const check = () => {
        if (isReady()) finish()
      }
      const handleVideoLoad = () => check()
      const handleError = event => {
        const detail = event && event.detail
        finish(detail && (detail.error || detail.message) ? (detail.error || new Error(detail.message)) : new Error('Failed to load Live Photo video.'))
      }

      const timeoutId = window.setTimeout(() => {
        finish(new Error('Timed out while preparing the Live Photo video.'))
      }, VIDEO_READY_TIMEOUT)

      player.addEventListener('videoload', handleVideoLoad, false)
      player.addEventListener('error', handleError, false)
      checkTimer = window.setInterval(check, 100)
      check()
    })
  }

  function getAudioTrack (element) {
    let audio = audioTracks.get(element)
    if (audio) return audio

    audio = new Audio(element.getAttribute('data-lp-video'))
    audio.loop = true
    audio.muted = false
    audio.volume = 1
    audio.preload = 'metadata'
    audio.setAttribute('playsinline', '')
    audioTracks.set(element, audio)
    return audio
  }

  function stopActiveAudioTrack () {
    if (!activeAudioTrack) return
    activeAudioTrack.pause()
    activeAudioTrack.currentTime = 0
    activeAudioTrack = null
  }

  function clearActivePlayback (element) {
    if (activePlayerElement !== element) return
    if (activePlaybackVisibilityObserver) activePlaybackVisibilityObserver.unobserve(element)
    activePlayerElement = null
    stopActiveAudioTrack()
    element.setAttribute('aria-pressed', 'false')
    element.classList.remove('live-photo__player--active')
    if (playbackMonitorId !== null) {
      window.clearInterval(playbackMonitorId)
      playbackMonitorId = null
    }
  }

  function playAudioTrack (element) {
    const audio = getAudioTrack(element)

    if (activeAudioTrack !== audio) {
      stopActiveAudioTrack()
      audio.currentTime = 0
      activeAudioTrack = audio
    }

    audio.muted = false
    audio.volume = 1
    const playResult = audio.play()
    if (playResult && typeof playResult.catch === 'function') {
      // Browsers can reject sound from a hover before the first user gesture.
      // A click, touch, or keyboard activation will retry it immediately.
      playResult.catch(() => {})
    }
  }

  // LivePhotosKit exposes pause/stop as read-only methods, so decorating them
  // throws and prevents the button from ever becoming ready. Monitor only the
  // selected player instead; when it stops, its companion audio stops too.
  function monitorActivePlayback () {
    if (playbackMonitorId !== null) return
    playbackMonitorId = window.setInterval(() => {
      if (!activePlayerElement) return
      const player = players.get(activePlayerElement)
      // Switching away clears the old player's decoded frames. It can report
      // isPlaying=false briefly while wantsToPlay=true and it prepares them
      // again. Treat only an explicit no-longer-wants-to-play state as stopped.
      if (!player || (!player.isPlaying && !player.wantsToPlay)) clearActivePlayback(activePlayerElement)
    }, 150)
  }

  function stopActivePlayback () {
    if (!activePlayerElement) return
    const element = activePlayerElement
    const player = players.get(element)
    if (player && typeof player.stop === 'function') player.stop()
    clearActivePlayback(element)
  }

  function observeActivePlaybackVisibility (element) {
    if (!('IntersectionObserver' in window)) return

    if (!activePlaybackVisibilityObserver) {
      activePlaybackVisibilityObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          // A Live Photo should never continue rendering or sounding after it
          // has scrolled completely out of view. Returning into view leaves it
          // paused; a new user gesture is required to start it again.
          if (activePlayerElement === entry.target && !entry.isIntersecting) stopActivePlayback()
        })
      }, { threshold: 0.01 })
    }

    activePlaybackVisibilityObserver.observe(element)
  }

  function activatePersistentPlayback (element, player) {
    if (getState(element) !== 'ready') return
    if (activePlayerElement && activePlayerElement !== element) {
      const previousElement = activePlayerElement
      const previousPlayer = players.get(previousElement)
      if (previousPlayer && typeof previousPlayer.stop === 'function') previousPlayer.stop()
      clearActivePlayback(previousElement)
    }

    player.play()
    playAudioTrack(element)
    activePlayerElement = element
    element.setAttribute('aria-pressed', 'true')
    element.classList.add('live-photo__player--active')
    monitorActivePlayback()
    observeActivePlaybackVisibility(element)
  }

  function bindPersistentPlayback (element, player) {
    const activate = event => {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return
      if (event.type === 'keydown') event.preventDefault()
      activatePersistentPlayback(element, player)
    }

    // Start on press rather than click so the Live Photo wins the first user
    // gesture instead of the backing video element consuming it first.
    element.addEventListener('pointerdown', event => {
      event.preventDefault()
      activatePersistentPlayback(element, player)
    }, true)
    element.addEventListener('pointerenter', activate)
    element.addEventListener('click', activate)
    element.addEventListener('keydown', activate)

    // LivePhotosKit stops loop effects on touchend. Keep the selected image
    // playing; the following click will also safely reassert the selection.
    element.addEventListener('touchend', event => {
      event.stopImmediatePropagation()
      activatePersistentPlayback(element, player)
    }, true)
  }

  async function initializeLivePhoto (element, generation) {
    setState(element, 'loading')

    try {
      const LivePhotosKit = await loadLivePhotosKit()
      const requestedEffect = element.getAttribute('data-lp-effect') || 'live'
      // `live` uses the SDK's one-shot recipe, which fades back to the still
      // photo at the end of every pass. Use its loop renderer for a stable,
      // continuously selected Live Photo; `bounce` and `loop` already map to
      // that renderer.
      const effectType = requestedEffect === 'live' ? 'loop' : requestedEffect

      if (generation !== pageGeneration || !canInitialize(element)) {
        setState(element, 'idle')
        return
      }

      const player = LivePhotosKit.augmentElementAsPlayer(element, {
        photoSrc: element.getAttribute('data-lp-photo'),
        videoSrc: element.getAttribute('data-lp-video'),
        effectType,
        caption: element.getAttribute('data-lp-caption') || 'Live Photo',
        autoplay: false,
        // Download and decode the video while the still photo is covered by
        // the loading layer. Playback will only be enabled after a frame is
        // renderable, preventing a network-driven white flash on first tap.
        proactivelyLoadsVideo: true,
        // The page owns the interaction and renders its own LIVE badge. Do not
        // expose the SDK's control layer, which is easily mistaken for a
        // native video player on mobile browsers.
        showsNativeControls: false
      })

      if (!player) throw new Error('LivePhotosKit did not create a player.')

      players.set(element, player)
      await waitForPhoto(player, element)
      await waitForVideoFrame(player)

      if (generation !== pageGeneration) {
        player.stop()
        return
      }

      setState(element, 'ready')
      bindPersistentPlayback(element, player)
      player.addEventListener('error', () => {
        if (activePlayerElement === element) {
          activePlayerElement = null
          stopActiveAudioTrack()
        }
        element.setAttribute('aria-pressed', 'false')
        element.classList.remove('live-photo__player--active')
        element.classList.add('live-photo__player--playback-error')
      }, false)
    } catch (error) {
      if (generation === pageGeneration && document.documentElement.contains(element)) {
        await renderFallback(element, error)
      }
    }
  }

  function drainQueue () {
    while (activeInitializations < MAX_CONCURRENT_PHOTOS && initializationQueue.length > 0) {
      const task = initializationQueue.shift()
      const element = task.element

      if (task.generation !== pageGeneration || getState(element) !== 'queued' || !canInitialize(element)) {
        if (getState(element) === 'queued') setState(element, 'idle')
        continue
      }

      activeInitializations++
      initializeLivePhoto(element, task.generation).then(() => {
        activeInitializations--
        drainQueue()
      }, () => {
        activeInitializations--
        drainQueue()
      })
    }
  }

  function enqueueInitialization (element) {
    if (getState(element) !== 'observing' || !canInitialize(element)) return
    fallbackTargets.delete(element)
    setState(element, 'queued')
    initializationQueue.push({ element: element, generation: pageGeneration })
    drainQueue()
  }

  function getIntersectionObserver () {
    if (intersectionObserver || !('IntersectionObserver' in window)) return intersectionObserver

    intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return
        intersectionObserver.unobserve(entry.target)
        enqueueInitialization(entry.target)
      })
    }, {
      root: null,
      rootMargin: `${VIEWPORT_MARGIN}px 0px`,
      threshold: 0.01
    })

    return intersectionObserver
  }

  function isNearViewport (element) {
    const bounds = element.getBoundingClientRect()
    return bounds.top <= window.innerHeight + VIEWPORT_MARGIN && bounds.bottom >= -VIEWPORT_MARGIN
  }

  function detachFallbackListeners () {
    if (!fallbackListenersAttached || fallbackTargets.size > 0) return
    fallbackListenersAttached = false
    window.removeEventListener('scroll', scheduleFallbackCheck)
    window.removeEventListener('resize', scheduleFallbackCheck)
  }

  function checkFallbackTargets () {
    fallbackFrame = 0

    fallbackTargets.forEach(element => {
      if (getState(element) !== 'observing' || !canInitialize(element)) {
        fallbackTargets.delete(element)
        return
      }

      if (isNearViewport(element)) enqueueInitialization(element)
    })

    detachFallbackListeners()
  }

  function scheduleFallbackCheck () {
    if (fallbackFrame) return
    fallbackFrame = window.requestAnimationFrame(checkFallbackTargets)
  }

  function observeWithoutIntersectionObserver (element) {
    fallbackTargets.add(element)

    if (!fallbackListenersAttached) {
      fallbackListenersAttached = true
      window.addEventListener('scroll', scheduleFallbackCheck, { passive: true })
      window.addEventListener('resize', scheduleFallbackCheck)
    }

    scheduleFallbackCheck()
  }

  function observeLivePhoto (element) {
    if (getState(element) !== 'idle' || !canInitialize(element)) return
    setState(element, 'observing')

    const observer = getIntersectionObserver()
    if (observer) {
      observer.observe(element)
    } else {
      observeWithoutIntersectionObserver(element)
    }
  }

  function activateDetails (details) {
    window.requestAnimationFrame(() => {
      forEachElement(details.querySelectorAll(LIVE_PHOTO_SELECTOR), observeLivePhoto)
    })
  }

  function deactivateDetails (details) {
    forEachElement(details.querySelectorAll(LIVE_PHOTO_SELECTOR), element => {
      const state = getState(element)

      if (intersectionObserver && state === 'observing') {
        intersectionObserver.unobserve(element)
        setState(element, 'idle')
      } else if (state === 'observing') {
        fallbackTargets.delete(element)
        setState(element, 'idle')
      } else if (state === 'queued') {
        setState(element, 'idle')
      }

      const player = players.get(element)
      if (player && typeof player.stop === 'function') player.stop()
      if (activePlayerElement === element) {
        clearActivePlayback(element)
      }
      element.setAttribute('aria-pressed', 'false')
      element.classList.remove('live-photo__player--active')
    })

    detachFallbackListeners()
  }

  function bindDetails (details) {
    if (boundDetails.has(details)) return
    boundDetails.add(details)

    details.addEventListener('toggle', () => {
      details.open ? activateDetails(details) : deactivateDetails(details)
    })
  }

  function registerLivePhoto (element) {
    if (!element.hasAttribute('data-lp-state')) setState(element, 'idle')

    const details = getParentDetails(element)
    if (!details) {
      observeLivePhoto(element)
      return
    }

    bindDetails(details)
    if (details.open) activateDetails(details)
  }

  function initLivePhotos (root) {
    const targets = []
    if (root.nodeType === 1 && root.matches(LIVE_PHOTO_SELECTOR)) targets.push(root)
    forEachElement(root.querySelectorAll(LIVE_PHOTO_SELECTOR), element => targets.push(element))
    targets.forEach(registerLivePhoto)
  }

  function resetUninitializedTargets () {
    forEachElement(document.querySelectorAll(LIVE_PHOTO_SELECTOR), element => {
      if (!players.has(element)) setState(element, 'idle')
    })
  }

  function stopCurrentPagePlayers () {
    pageGeneration++
    initializationQueue.length = 0
    fallbackTargets.clear()

    forEachElement(document.querySelectorAll(LIVE_PHOTO_SELECTOR), element => {
      const player = players.get(element)
      if (player && typeof player.stop === 'function') player.stop()
      element.setAttribute('aria-pressed', 'false')
      element.classList.remove('live-photo__player--active')
    })

    stopActivePlayback()

    if (intersectionObserver) {
      intersectionObserver.disconnect()
      intersectionObserver = null
    }

    if (fallbackFrame) {
      window.cancelAnimationFrame(fallbackFrame)
      fallbackFrame = 0
    }

    detachFallbackListeners()
    resetUninitializedTargets()
  }

  function start () {
    initLivePhotos(document)
  }

  function forceFullNavigationFromLivePhotoPage (event) {
    if (!document.querySelector(LIVE_PHOTO_SELECTOR) || event.defaultPrevented || event.button !== 0) return
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return

    const link = event.target.closest('a[href]')
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return

    const targetUrl = new URL(link.href, window.location.href)
    if (targetUrl.origin !== window.location.origin) return
    if (targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search) return

    event.preventDefault()
    event.stopImmediatePropagation()
    window.location.assign(targetUrl.href)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  document.addEventListener('click', forceFullNavigationFromLivePhotoPage, true)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopActivePlayback()
  })
  window.addEventListener('pagehide', stopActivePlayback)
  document.addEventListener('pjax:send', stopCurrentPagePlayers)
  document.addEventListener('pjax:complete', start)
  document.addEventListener('pjax:error', start)
})()
