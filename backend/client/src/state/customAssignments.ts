import type { Assignment } from '@/types/api'

const KEY = 'custom-assignments'

function load(): Assignment[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function save(items: Assignment[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
}

export function getAllCustomAssignments(): Assignment[] {
  return load()
}

export function addCustomAssignment(a: Assignment) {
  const curr = load()
  save([a, ...curr])
}

export function addManyCustomAssignments(list: Assignment[]) {
  const curr = load()
  save([...list, ...curr])
}

