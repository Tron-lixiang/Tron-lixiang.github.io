;(function () {
  if (window.lixiangWeatherScheduled) return
  window.lixiangWeatherScheduled = true

  const CACHE_KEY = 'lixiangpro:weather-api:v1'
  const LEGACY_CACHE_KEY = 'lixiangpro:weather-widget:v1'
  const CACHE_TTL = 30 * 60 * 1000
  const WEATHER_API_HOST = 'widget-v3.seniverse.com'
  const WEATHER_API_PATH = '/api/weather/'
  const container = document.getElementById('tp-weather-widget')

  if (!container) return

  const removeCache = key => {
    try {
      window.localStorage.removeItem(key)
    } catch (error) {}
  }

  const readStoredCache = () => {
    try {
      const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY))
      const age = cached ? Date.now() - cached.updatedAt : NaN

      if (
        !cached ||
        getWeatherUrl(cached.url) !== cached.url ||
        typeof cached.body !== 'string' ||
        !Number.isFinite(age) ||
        age < 0 ||
        age >= CACHE_TTL
      ) {
        removeCache(CACHE_KEY)
        return null
      }

      const response = JSON.parse(cached.body)
      if (!response || response.success !== true) {
        removeCache(CACHE_KEY)
        return null
      }

      return cached
    } catch (error) {
      removeCache(CACHE_KEY)
      return null
    }
  }

  const readCache = url => {
    const cached = readStoredCache()
    return cached && cached.url === url ? cached.body : null
  }

  const writeCache = (url, body) => {
    try {
      const response = JSON.parse(body)
      if (!response || response.success !== true) return

      window.localStorage.setItem(CACHE_KEY, JSON.stringify({
        updatedAt: Date.now(),
        url,
        body
      }))
    } catch (error) {}
  }

  const getWeatherUrl = url => {
    try {
      const absoluteUrl = new URL(String(url), window.location.href).href
      const parsedUrl = new URL(absoluteUrl)
      return parsedUrl.hostname === WEATHER_API_HOST && parsedUrl.pathname.indexOf(WEATHER_API_PATH) === 0
        ? absoluteUrl
        : ''
    } catch (error) {
      return ''
    }
  }

  const installWeatherApiCache = () => {
    const nativeOpen = window.XMLHttpRequest.prototype.open
    const nativeSend = window.XMLHttpRequest.prototype.send

    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.lixiangWeatherApiUrl = String(method).toUpperCase() === 'GET' ? getWeatherUrl(url) : ''
      return nativeOpen.apply(this, arguments)
    }

    window.XMLHttpRequest.prototype.send = function () {
      const weatherUrl = this.lixiangWeatherApiUrl
      if (!weatherUrl) return nativeSend.apply(this, arguments)

      const cachedBody = readCache(weatherUrl)
      if (!cachedBody) {
        this.addEventListener('load', () => {
          if (this.status < 200 || this.status >= 300) return

          try {
            const body = this.responseType === 'json'
              ? JSON.stringify(this.response)
              : this.responseText
            writeCache(weatherUrl, body)
          } catch (error) {}
        }, { once: true })

        return nativeSend.apply(this, arguments)
      }

      const xhr = this
      const sendArguments = arguments
      window.setTimeout(() => {
        try {
          const response = xhr.responseType === 'json' ? JSON.parse(cachedBody) : cachedBody

          Object.defineProperties(xhr, {
            readyState: { configurable: true, get: () => 4 },
            status: { configurable: true, get: () => 200 },
            statusText: { configurable: true, get: () => 'OK' },
            responseURL: { configurable: true, get: () => weatherUrl },
            responseText: { configurable: true, get: () => cachedBody },
            response: { configurable: true, get: () => response }
          })

          xhr.getAllResponseHeaders = () => 'content-type: application/json; charset=utf-8\r\n'
          xhr.getResponseHeader = name => String(name).toLowerCase() === 'content-type'
            ? 'application/json; charset=utf-8'
            : null
        } catch (error) {
          removeCache(CACHE_KEY)
          nativeSend.apply(xhr, sendArguments)
          return
        }

        xhr.dispatchEvent(new Event('readystatechange'))
        xhr.dispatchEvent(new ProgressEvent('load', {
          lengthComputable: true,
          loaded: cachedBody.length,
          total: cachedBody.length
        }))
        xhr.dispatchEvent(new ProgressEvent('loadend', {
          lengthComputable: true,
          loaded: cachedBody.length,
          total: cachedBody.length
        }))
      }, 0)
    }
  }

  const loadWeather = () => {
    installWeatherApiCache()
    removeCache(LEGACY_CACHE_KEY)

    window.SeniverseWeatherWidgetObject = 'SeniverseWeatherWidget'
    window.SeniverseWeatherWidget = window.SeniverseWeatherWidget || function () {
      (window.SeniverseWeatherWidget.q = window.SeniverseWeatherWidget.q || []).push(arguments)
    }
    window.SeniverseWeatherWidget.l = Date.now()
    window.SeniverseWeatherWidget('show', {
      flavor: 'slim',
      location: 'WTW3SJ5ZBJUY',
      geolocation: true,
      language: 'zh-Hans',
      unit: 'c',
      theme: 'auto',
      token: 'f1148d25-6ea4-4996-be0d-1773f7c01857',
      hover: 'enabled',
      container: 'tp-weather-widget'
    })

    const script = document.createElement('script')
    script.src = 'https://cdn.sencdn.com/widget2/static/js/bundle.js?t=' + Math.floor(Date.now() / 100000000)
    script.charset = 'utf-8'
    script.async = true
    document.head.appendChild(script)
  }

  const scheduleWeather = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(loadWeather, { timeout: 5000 })
    } else {
      window.setTimeout(loadWeather, 2000)
    }
  }

  if (readStoredCache()) {
    loadWeather()
  } else if (document.readyState === 'complete') {
    scheduleWeather()
  } else {
    window.addEventListener('load', scheduleWeather, { once: true })
  }
})()
