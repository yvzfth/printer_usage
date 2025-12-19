import { mkdir, readdir, readFile, unlink, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { join, resolve } from "path"
import { list, put, del } from "@vercel/blob"

type PeriodsPayload = unknown

export type ReportSummary = {
  id: string
  reportName: string
  userName: string
  createdAt: string
  fileCount: number
}

export type StoredReport = {
  id: string
  reportName: string
  userName: string
  userSlug: string
  createdAt: string
  updatedAt?: string
  periods: PeriodsPayload
}

const STORAGE_PATH = process.env.REPORTS_DIRECTORY
  ? resolve(process.env.REPORTS_DIRECTORY)
  : join(process.cwd(), "storage", "reports")

const BLOB_STORE_NAME = process.env.BLOB_STORE_NAME || "irhprinterreport-blob"
const BLOB_PREFIX = process.env.BLOB_PREFIX || "reports"
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN
const BLOB_BASE_URL = `https://${BLOB_STORE_NAME}.public.blob.vercel-storage.com`

export function slugifyUserName(userName: string) {
  return (
    userName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "user"
  )
}

function buildReportId(userSlug: string) {
  return `${userSlug}__${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

const useBlobStorage = () => Boolean(BLOB_TOKEN || process.env.VERCEL === "1")

// ---------- Local filesystem helpers ----------
async function ensureStorageDir() {
  if (!existsSync(STORAGE_PATH)) {
    await mkdir(STORAGE_PATH, { recursive: true })
  }
}

async function ensureUserDir(userName: string) {
  await ensureStorageDir()
  const slug = slugifyUserName(userName)
  const dir = join(STORAGE_PATH, slug)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  return { dir, slug }
}

async function readDirReports(dirPath: string) {
  const files = await readdir(dirPath)
  const reports: StoredReport[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const content = await readFile(join(dirPath, file), "utf-8")
      reports.push(JSON.parse(content))
    } catch (error) {
      console.warn(`Failed to read report ${file}:`, error)
    }
  }
  return reports
}

async function listLocalReports(): Promise<Record<string, ReportSummary[]>> {
  await ensureStorageDir()
  const entries = await readdir(STORAGE_PATH, { withFileTypes: true })
  const grouped: Record<string, ReportSummary[]> = {}

  const rootFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  if (rootFiles.length > 0) {
    const reports = await Promise.all(
      rootFiles.map(async (entry) => {
        const content = await readFile(join(STORAGE_PATH, entry.name), "utf-8")
        return JSON.parse(content)
      }),
    )
    reports.forEach((report) => {
      const key = report.userName || "Unknown"
      if (!grouped[key]) grouped[key] = []
      grouped[key].push({
        id: report.id,
        reportName: report.reportName,
        userName: report.userName,
        createdAt: report.createdAt,
        fileCount: report.periods?.length || 0,
      })
    })
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = join(STORAGE_PATH, entry.name)
    const reports = await readDirReports(dirPath)
    reports.forEach((report) => {
      const key = report.userName || "Unknown"
      if (!grouped[key]) grouped[key] = []
      grouped[key].push({
        id: report.id,
        reportName: report.reportName,
        userName: report.userName,
        createdAt: report.createdAt,
        fileCount: report.periods?.length || 0,
      })
    })
  }

  Object.values(grouped).forEach((userReports) => {
    userReports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  })

  return grouped
}

async function reportNameExistsLocal(userName: string, reportName: string, excludeId?: string) {
  await ensureStorageDir()
  const normalizedUser = userName.trim().toLowerCase()
  const normalizedName = reportName.trim().toLowerCase()
  const entries = await readdir(STORAGE_PATH, { withFileTypes: true })

  const checkFile = async (filePath: string) => {
    const content = await readFile(filePath, "utf-8")
    const data = JSON.parse(content)
    if (excludeId && data?.id === excludeId) return false
    return (
      typeof data?.userName === "string" &&
      typeof data?.reportName === "string" &&
      data.userName.trim().toLowerCase() === normalizedUser &&
      data.reportName.trim().toLowerCase() === normalizedName
    )
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      if (await checkFile(join(STORAGE_PATH, entry.name))) {
        return true
      }
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = join(STORAGE_PATH, entry.name)
    const files = await readdir(dirPath)
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      if (await checkFile(join(dirPath, file))) {
        return true
      }
    }
  }

  return false
}

async function resolveLocalReportPath(id: string) {
  if (!existsSync(STORAGE_PATH)) return null
  const slug = id.includes("__") ? id.split("__")[0] : null
  if (slug) {
    const direct = join(STORAGE_PATH, slug, `${id}.json`)
    if (existsSync(direct)) return direct
  }
  const root = join(STORAGE_PATH, `${id}.json`)
  if (existsSync(root)) return root
  const entries = await readdir(STORAGE_PATH, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(STORAGE_PATH, entry.name, `${id}.json`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function loadLocalReport(id: string) {
  const path = await resolveLocalReportPath(id)
  if (!path) return null
  const content = await readFile(path, "utf-8")
  return JSON.parse(content) as StoredReport
}

async function saveLocalReport(reportName: string, userName: string, periods: PeriodsPayload) {
  const { dir, slug } = await ensureUserDir(userName)
  const id = buildReportId(slug)
  const report: StoredReport = {
    id,
    reportName,
    userName,
    userSlug: slug,
    createdAt: new Date().toISOString(),
    periods,
  }
  await writeFile(join(dir, `${id}.json`), JSON.stringify(report, null, 2))
  return { id }
}

async function overwriteLocalReport(path: string, update: Partial<StoredReport>) {
  const existing = JSON.parse(await readFile(path, "utf-8"))
  const updated: StoredReport = {
    ...existing,
    ...update,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(path, JSON.stringify(updated, null, 2))
  return updated
}

// ---------- Vercel Blob helpers ----------
const buildBlobKey = (userSlug: string, id: string) => `${BLOB_PREFIX}/${userSlug}/${id}.json`

async function listAllBlobs() {
  const blobs = []
  let cursor: string | undefined
  do {
    const res = await list({ token: BLOB_TOKEN, limit: 1000, prefix: `${BLOB_PREFIX}/`, cursor })
    blobs.push(...res.blobs)
    cursor = res.cursor
  } while (cursor)
  return blobs
}

async function fetchBlobJson(url: string) {
  const res = await fetch(url, {
    headers: BLOB_TOKEN ? { Authorization: `Bearer ${BLOB_TOKEN}` } : undefined,
    cache: "no-store",
  })
  if (!res.ok) return null
  return (await res.json()) as StoredReport
}

async function listBlobReports(): Promise<Record<string, ReportSummary[]>> {
  const grouped: Record<string, ReportSummary[]> = {}
  const blobs = await listAllBlobs()
  for (const blob of blobs) {
    const report = await fetchBlobJson(blob.url)
    if (!report) continue
    const key = report.userName || "Unknown"
    if (!grouped[key]) grouped[key] = []
    grouped[key].push({
      id: report.id,
      reportName: report.reportName,
      userName: report.userName,
      createdAt: report.createdAt,
      fileCount: (report as any)?.periods?.length || 0,
    })
  }
  Object.values(grouped).forEach((userReports) => {
    userReports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  })
  return grouped
}

async function reportNameExistsBlob(userName: string, reportName: string, excludeId?: string) {
  const normalizedUser = userName.trim().toLowerCase()
  const normalizedName = reportName.trim().toLowerCase()
  const blobs = await listAllBlobs()
  for (const blob of blobs) {
    const report = await fetchBlobJson(blob.url)
    if (!report) continue
    if (excludeId && report.id === excludeId) continue
    if (
      report.userName?.trim().toLowerCase() === normalizedUser &&
      report.reportName?.trim().toLowerCase() === normalizedName
    ) {
      return true
    }
  }
  return false
}

async function loadBlobReport(id: string) {
  const slug = id.includes("__") ? id.split("__")[0] : ""
  const key = buildBlobKey(slug, id)
  const url = `${BLOB_BASE_URL}/${key}`
  const report = await fetchBlobJson(url)
  if (report) return report
  // fallback: search
  const blobs = await listAllBlobs()
  const match = blobs.find((blob) => blob.url.includes(`/${id}.json`))
  if (!match) return null
  return fetchBlobJson(match.url)
}

async function saveBlobReport(reportName: string, userName: string, periods: PeriodsPayload) {
  const userSlug = slugifyUserName(userName)
  const id = buildReportId(userSlug)
  const key = buildBlobKey(userSlug, id)
  const report: StoredReport = {
    id,
    reportName,
    userName,
    userSlug,
    createdAt: new Date().toISOString(),
    periods,
  }
  await put(key, JSON.stringify(report, null, 2), {
    access: "private",
    contentType: "application/json",
    token: BLOB_TOKEN,
  })
  return { id }
}

async function overwriteBlobReport(existing: StoredReport, updates: Partial<StoredReport>) {
  const merged: StoredReport = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  }
  const key = buildBlobKey(merged.userSlug, merged.id)
  await put(key, JSON.stringify(merged, null, 2), {
    access: "private",
    contentType: "application/json",
    token: BLOB_TOKEN,
  })
  return merged
}

async function deleteBlobReport(id: string) {
  const slug = id.includes("__") ? id.split("__")[0] : ""
  const key = buildBlobKey(slug, id)
  const url = `${BLOB_BASE_URL}/${key}`
  await del(url, { token: BLOB_TOKEN })
}

// ---------- Public API used by routes ----------
export async function listReportSummaries() {
  if (useBlobStorage()) {
    return listBlobReports()
  }
  return listLocalReports()
}

export async function checkReportNameExists(userName: string, reportName: string, excludeId?: string) {
  if (useBlobStorage()) {
    return reportNameExistsBlob(userName, reportName, excludeId)
  }
  return reportNameExistsLocal(userName, reportName, excludeId)
}

export async function createReport(reportName: string, userName: string, periods: PeriodsPayload) {
  if (useBlobStorage()) {
    return saveBlobReport(reportName, userName, periods)
  }
  return saveLocalReport(reportName, userName, periods)
}

export async function getReportById(id: string) {
  if (useBlobStorage()) {
    return loadBlobReport(id)
  }
  return loadLocalReport(id)
}

export async function deleteReportById(id: string) {
  if (useBlobStorage()) {
    await deleteBlobReport(id)
    return
  }
  const path = await resolveLocalReportPath(id)
  if (!path) return
  await unlink(path)
}

export async function overwriteReport(id: string, updates: Partial<StoredReport> & { periods?: PeriodsPayload }) {
  if (useBlobStorage()) {
    const existing = await loadBlobReport(id)
    if (!existing) return null
    return overwriteBlobReport(existing, updates)
  }
  const path = await resolveLocalReportPath(id)
  if (!path) return null
  return overwriteLocalReport(path, updates)
}

export { buildReportId }
