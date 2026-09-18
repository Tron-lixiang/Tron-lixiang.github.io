window.addEventListener('load', () => {
  let search
  let instantSearchLoading
  let searchInitialization

  const loadInstantSearch = () => {
    if (window.instantsearch) return Promise.resolve()
    if (instantSearchLoading) return instantSearchLoading

    const { js, css } = GLOBAL_CONFIG.source.algolia
    const stylesheet = document.createElement('link')
    stylesheet.rel = 'stylesheet'
    stylesheet.href = css
    document.head.appendChild(stylesheet)

    instantSearchLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = js
      script.async = true
      script.onload = resolve
      script.onerror = () => reject(new Error('Unable to load InstantSearch.'))
      document.head.appendChild(script)
    })

    return instantSearchLoading
  }

  const initializeSearch = () => {
    if (search) return Promise.resolve(search)
    if (searchInitialization) return searchInitialization

    const algolia = GLOBAL_CONFIG.algolia
    const isAlgoliaValid = algolia.appId && algolia.apiKey && algolia.indexName
    if (!isAlgoliaValid) return Promise.reject(new Error('Algolia setting is invalid.'))

    searchInitialization = loadInstantSearch().then(() => {
      if (search) return search

      search = instantsearch({
        appId: algolia.appId,
        apiKey: algolia.apiKey,
        indexName: algolia.indexName,
        searchParameters: {
          hitsPerPage: algolia.hits.per_page || 10
        },
        searchFunction: function (helper) {
          const searchInput = document.querySelector('#algolia-search-input input')
          if (searchInput && searchInput.value) helper.search()
        }
      })

      search.addWidget(
        instantsearch.widgets.searchBox({
          container: '#algolia-search-input',
          reset: false,
          magnifier: false,
          placeholder: algolia.languages.input_placeholder
        })
      )
      search.addWidget(
        instantsearch.widgets.hits({
          container: '#algolia-hits',
          templates: {
            item: function (data) {
              const link = data.permalink ? data.permalink : (GLOBAL_CONFIG.root + data.path)
              return (
                '<a href="' + link + '" class="algolia-hit-item-link">' +
                data._highlightResult.title.value +
                '</a>'
              )
            },
            empty: function (data) {
              return (
                '<div id="algolia-hits-empty">' +
                algolia.languages.hits_empty.replace(/\$\{query}/, data.query) +
                '</div>'
              )
            }
          },
          cssClasses: {
            item: 'algolia-hit-item'
          }
        })
      )

      search.addWidget(
        instantsearch.widgets.stats({
          container: '#algolia-stats',
          templates: {
            body: function (data) {
              const stats = algolia.languages.hits_stats
                .replace(/\$\{hits}/, data.nbHits)
                .replace(/\$\{time}/, data.processingTimeMS)
              return (
                '<hr>' +
                stats +
                '<span class="algolia-logo pull-right">' +
                '  <img src="' + GLOBAL_CONFIG.root + 'img/algolia.svg" alt="Algolia" />' +
                '</span>'
              )
            }
          }
        })
      )

      search.addWidget(
        instantsearch.widgets.pagination({
          container: '#algolia-pagination',
          scrollTo: false,
          showFirstLast: false,
          labels: {
            first: '<i class="fas fa-angle-double-left"></i>',
            last: '<i class="fas fa-angle-double-right"></i>',
            previous: '<i class="fas fa-angle-left"></i>',
            next: '<i class="fas fa-angle-right"></i>'
          },
          cssClasses: {
            root: 'pagination',
            item: 'pagination-item',
            link: 'page-number',
            active: 'current',
            disabled: 'disabled-item'
          }
        })
      )
      search.start()

      if (window.pjax) {
        search.on('render', () => window.pjax.refresh(document.getElementById('algolia-hits')))
      }

      return search
    })

    return searchInitialization.catch(error => {
      searchInitialization = undefined
      throw error
    })
  }

  const closeSearch = () => {
    document.body.style.cssText = "width: '';overflow: ''"
    const $searchDialog = document.querySelector('#algolia-search .search-dialog')
    $searchDialog.style.animation = 'search_close .5s'
    setTimeout(() => { $searchDialog.style.cssText = "display: none; animation: ''" }, 500)
    btf.fadeOut(document.getElementById('search-mask'), 0.5)
  }

  const openSearch = () => {
    document.body.style.cssText = 'width: 100%;overflow: hidden'
    document.querySelector('#algolia-search .search-dialog').style.display = 'block'
    btf.fadeIn(document.getElementById('search-mask'), 0.5)

    initializeSearch()
      .then(() => document.querySelector('#algolia-search .ais-search-box--input').focus())
      .catch(error => console.error(error.message))

    document.addEventListener('keydown', function f (event) {
      if (event.code === 'Escape') {
        closeSearch()
        document.removeEventListener('keydown', f)
      }
    })
  }

  const searchClickFn = () => {
    document.querySelector('#search-button > .search').addEventListener('click', openSearch)
    document.getElementById('search-mask').addEventListener('click', closeSearch)
    document.querySelector('#algolia-search .search-close-button').addEventListener('click', closeSearch)
  }

  searchClickFn()

  window.addEventListener('pjax:complete', function () {
    getComputedStyle(document.querySelector('#algolia-search .search-dialog')).display === 'block' && closeSearch()
    searchClickFn()
  })
})
