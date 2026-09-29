;(function () {
  if (window.lixiangWeatherScheduled) return
  window.lixiangWeatherScheduled = true

  const loadWeather = () => {
    if (!document.getElementById('tp-weather-widget')) return

    window.SeniverseWeatherWidgetObject = 'SeniverseWeatherWidget'
    window.SeniverseWeatherWidget = window.SeniverseWeatherWidget || function () {
      (window.SeniverseWeatherWidget.q = window.SeniverseWeatherWidget.q || []).push(arguments)
    }
    window.SeniverseWeatherWidget.l = Date.now()
    window.SeniverseWeatherWidget('show', {
      flavor: "slim",
      location: "WTW3SJ5ZBJUY",
      geolocation: true,
      language: "zh-Hans",
      unit: "c",
      theme: "auto",
      token: "f1148d25-6ea4-4996-be0d-1773f7c01857",
      hover: "enabled",
      container: "tp-weather-widget"
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

  if (document.readyState === 'complete') scheduleWeather()
  else window.addEventListener('load', scheduleWeather, { once: true })
})()
