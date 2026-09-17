(function () {
  'use strict'

  const LIVE_PHOTO_SELECTOR = '.js-live-photo'
  const SDK_URL = '/js/livephotoskit.js'
  const MAX_CONCURRENT_PHOTOS = 2
  const SDK_TIMEOUT = 20000
  const PHOTO_TIMEOUT = 20000
  const VIEWPORT_MARGIN = 320

  const boundDetails = new WeakSet()
  const players = new WeakMap()
  const audioTracks = new WeakMap()
  const initializationQueue = []
  const fallbackTargets = new Set()

  let intersectionObserver = null
  let livePhotosKitPromise = null
  let activeInitializations = 0
  let fallbackFrame = 0
  let fallbackListenersAttached = false
  let pageGeneration = 0
  let activePlayerElement = null
  let activeAudioTrack = null

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

    const figure = element.closest('.live-photo')
    const styleTarget = figure || element
    const isPortrait = naturalHeight > naturalWidth
    const aspectRatio = `${naturalWidth} / ${naturalHeight}`

    styleTarget.style.setProperty('--live-photo-aspect-ratio', aspectRatio)
    element.style.aspectRatio = aspectRatio
    element.style.minHeight = '0'
    element.setAttribute('data-lp-aspect-ratio', `${naturalWidth}:${naturalHeight}`)

    if (figure) {
      figure.classList.toggle('live-photo--portrait', isPortrait)
      figure.classList.toggle('live-photo--landscape', !isPortrait)
    }
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

  function activatePersistentPlayback (element, player) {
    if (activePlayerElement && activePlayerElement !== element) {
      const previousPlayer = players.get(activePlayerElement)
      if (previousPlayer && typeof previousPlayer.stop === 'function') previousPlayer.stop()
      activePlayerElement.setAttribute('aria-pressed', 'false')
      activePlayerElement.classList.remove('live-photo__player--active')
    }

    player.play()
    playAudioTrack(element)
    activePlayerElement = element
    element.setAttribute('aria-pressed', 'true')
    element.classList.add('live-photo__player--active')
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

      if (generation !== pageGeneration || !canInitialize(element)) {
        setState(element, 'idle')
        return
      }

      const player = LivePhotosKit.augmentElementAsPlayer(element, {
        photoSrc: element.getAttribute('data-lp-photo'),
        videoSrc: element.getAttribute('data-lp-video'),
        effectType: element.getAttribute('data-lp-effect') || 'live',
        caption: element.getAttribute('data-lp-caption') || 'Live Photo',
        autoplay: false,
        proactivelyLoadsVideo: false,
        // LivePhotosKit's control layer also supplies the desktop click
        // interaction. Keep it enabled; mobile video taps are isolated in CSS.
        showsNativeControls: true
      })

      if (!player) throw new Error('LivePhotosKit did not create a player.')

      players.set(element, player)
      await waitForPhoto(player, element)

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
        activePlayerElement = null
        stopActiveAudioTrack()
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

    activePlayerElement = null
    stopActiveAudioTrack()

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
  document.addEventListener('pjax:send', stopCurrentPagePlayers)
  document.addEventListener('pjax:complete', start)
  document.addEventListener('pjax:error', start)
})()
