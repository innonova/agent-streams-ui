import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from '@/stores/session'

/**
 * Two addresses for one screen: the tree with nobody selected, and the
 * tree with an agent beside it. An agent is found by its id alone; which
 * stream it belongs to is the manager's to say.
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    { path: '/', name: 'work', component: () => import('@/views/WorkView.vue') },
    {
      path: '/a/:agentId',
      name: 'agent',
      component: () => import('@/views/WorkView.vue'),
      props: true,
    },
    { path: '/:rest(.*)*', redirect: { name: 'work' } },
  ],
})

router.beforeEach(async (to) => {
  const session = useSessionStore()
  if (!session.checked) await session.restore()
  if (!to.meta.public && !session.user) return { name: 'login', query: { next: to.fullPath } }
  if (to.name === 'login' && session.user) return { name: 'work' }
  return true
})

/**
 * A deploy replaces the hashed chunk files, so the first lazy route a
 * tab opens after an update fails to load its module. That is not a
 * broken app but a stale one: reload straight into the new build at the
 * requested address. A failure right after such a reload is something
 * else, and is reported instead of looping.
 */
const CHUNK_ERROR = /dynamically imported module|Importing a module script|Loading chunk|preload/i
const RELOAD_MARK = 'chunk-reload'

export function reloadForNewBuild(target: string): boolean {
  const last = Number(sessionStorage.getItem(RELOAD_MARK) ?? 0)
  if (Date.now() - last < 15_000) return false
  sessionStorage.setItem(RELOAD_MARK, String(Date.now()))
  location.assign(target)
  return true
}

router.onError((error, to) => {
  if (!CHUNK_ERROR.test(String(error?.message ?? error))) return
  if (reloadForNewBuild(router.resolve(to).href)) return
  import('@/stores/notifications').then(({ useNotificationsStore }) =>
    useNotificationsStore().push(
      'error',
      'this page could not be loaded; reload the tab to get the current version',
      15_000,
    ),
  )
})
// Vite's own signal for a missing stylesheet or preloaded chunk.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  reloadForNewBuild(location.pathname + location.search)
})

export default router
