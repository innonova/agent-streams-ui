import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api/client'
import { events } from '@/api/events'
import type { AgentCounts, ArchiveProgress, Project, RepoInput } from '@/api/types'

export interface ProjectRow {
  project: Project
  agentCounts: AgentCounts
}

export const useProjectsStore = defineStore('projects', () => {
  const rows = ref<ProjectRow[]>([])
  const loaded = ref(false)
  const byId = computed(() => new Map(rows.value.map((r) => [r.project.id, r])))

  /** The streams that are put away: out of `rows`, and so out of the tree, until they are brought back. */
  const away = ref<ProjectRow[]>([])
  /** Where a stream is and how far on its way there or back, as the manager last said. */
  const moving = ref(new Map<string, { archive: Project['archive']; progress: ArchiveProgress }>())

  events.on((f) => {
    if (f.type === 'project.counts') {
      const row = byId.value.get(f.projectId)
      if (row) row.agentCounts = f.counts
    }
    if (f.type === 'project.archive') {
      moving.value = new Map(moving.value).set(f.projectId, {
        archive: f.archive,
        progress: f.progress,
      })
      const row =
        byId.value.get(f.projectId) ?? away.value.find((r) => r.project.id === f.projectId)
      if (row) row.project.archive = f.archive
      // it changed lists (went away, came back), or was never in ours: ask again
      const listed = byId.value.has(f.projectId)
      if (!row || listed === (f.archive?.state === 'archived')) void load()
    }
  })

  async function load(): Promise<void> {
    const [here, gone] = await Promise.all([api.projects(), api.projectsAway().catch(() => [])])
    rows.value = here
    away.value = gone
    loaded.value = true
  }
  events.onReconnect = ((prev) => () => {
    prev?.()
    if (loaded.value) void load() // counts may have moved while the socket was down
  })(events.onReconnect)
  events.on((f) => {
    if (f.type === 'host.reconnected' && loaded.value) void load() // that machine's projects are listed again
  })

  const sorted = (list: ProjectRow[]) =>
    [...list].sort((a, b) => a.project.name.localeCompare(b.project.name))

  async function create(input: {
    name: string
    repos: RepoInput[]
    defaultProfile?: string | null
    delegation?: 'free' | 'on-request'
    host?: string
  }): Promise<Project> {
    const row = await api.createProject(input)
    rows.value = sorted([...rows.value, row])
    return row.project
  }

  async function createStream(input: {
    name: string
    purpose?: string
    defaultProfile?: string | null
    group?: string | null
  }): Promise<Project> {
    const row = await api.createStream(input)
    rows.value = sorted([...rows.value, row])
    return row.project
  }

  async function update(
    id: string,
    input: {
      name?: string
      repos?: RepoInput[]
      defaultProfile?: string | null
      delegation?: 'free' | 'on-request'
      group?: string | null
    },
  ): Promise<Project> {
    const row = await api.updateProject(id, input)
    rows.value = sorted(rows.value.map((r) => (r.project.id === id ? row : r)))
    return row.project
  }

  async function remove(id: string): Promise<void> {
    await api.deleteProject(id)
    rows.value = rows.value.filter((r) => r.project.id !== id)
  }

  /** Puts a stream away; refused with the reasons when something stands in the way. The frames say how it goes. */
  async function putAway(id: string, input: { discard?: boolean; compact?: boolean }) {
    const { project } = await api.archiveStream(id, input)
    const row = byId.value.get(id)
    if (row) row.project.archive = project.archive
  }

  async function bringBack(id: string) {
    const { project } = await api.reviveStream(id)
    const row = away.value.find((r) => r.project.id === id)
    if (row) row.project.archive = project.archive
  }

  return {
    rows,
    away,
    moving,
    loaded,
    byId,
    load,
    create,
    createStream,
    update,
    remove,
    putAway,
    bringBack,
  }
})
