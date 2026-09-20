// Keep Busuanzi's raw response separate from the displayed total, so repeated
// responses never add the historical baseline more than once.
;(function () {
  const observers = []
  const bindCounters = () => {
    observers.forEach(observer => observer.disconnect())
    observers.length = 0
    document.querySelectorAll('[data-busuanzi-total]').forEach(display => {
      const raw = document.getElementById('busuanzi_value_' + display.dataset.busuanziTotal)
      const history = Number(display.dataset.history)
      if (!raw || !Number.isSafeInteger(history) || history < 0) return

      const update = () => {
        const value = raw.textContent.trim()
        const current = Number(value)
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(current) || !Number.isSafeInteger(history + current)) {
          display.textContent = '—'
          return
        }
        display.textContent = String(history + current)
      }
      const observer = new MutationObserver(update)
      observer.observe(raw, { childList: true, characterData: true, subtree: true })
      observers.push(observer)
      update()
    })
  }
  bindCounters()
  window.addEventListener('pjax:complete', bindCounters)
})()
