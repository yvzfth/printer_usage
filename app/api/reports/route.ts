import { NextResponse } from "next/server"
import { readdir, readFile, writeFile, mkdir } from "fs/promises"
import { join, resolve } from "path"
import { existsSync } from "fs"

const STORAGE_PATH = process.env.REPORTS_DIRECTORY
  ? resolve(process.env.REPORTS_DIRECTORY)
  : join(process.cwd(), "storage", "reports")

type ReportSummary = {
  id: string
  reportName: string
  userName: string
  createdAt: string
  fileCount: number
}

function slugifyUserName(userName: string) {
  return userName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "user"
}

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

async function reportNameExists(userName: string, reportName: string) {
  await ensureStorageDir()
  const normalizedUser = userName.trim().toLowerCase()
  const normalizedName = reportName.trim().toLowerCase()
  const entries = await readdir(STORAGE_PATH, { withFileTypes: true })

  const checkFile = async (filePath: string) => {
    const content = await readFile(filePath, "utf-8")
    const data = JSON.parse(content)
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

async function readReportSummaries(): Promise<Record<string, ReportSummary[]>> {
  await ensureStorageDir()
  const entries = await readdir(STORAGE_PATH, { withFileTypes: true })
  const grouped: Record<string, ReportSummary[]> = {}

  const readDirFiles = async (dirPath: string) => {
    const files = await readdir(dirPath)
    return Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const content = await readFile(join(dirPath, file), "utf-8")
          return JSON.parse(content)
        }),
    )
  }

  const rootFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  if (rootFiles.length > 0) {
    const rootReports = await Promise.all(
      rootFiles.map(async (entry) => {
        const content = await readFile(join(STORAGE_PATH, entry.name), "utf-8")
        return JSON.parse(content)
      }),
    )
    rootReports.forEach((report) => {
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
    const reports = await readDirFiles(dirPath)
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

  // Sort reports for each user newest first
  Object.values(grouped).forEach((userReports) => {
    userReports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  })

  return grouped
}

function buildReportId(userSlug: string) {
  return `${userSlug}__${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

// GET: List all saved reports grouped by user
export async function GET() {
  try {
    const grouped = await readReportSummaries()
    return NextResponse.json({ success: true, reports: grouped })
  } catch (error) {
    console.error("Error reading reports:", error)
    return NextResponse.json({ success: false, error: "Failed to read reports" }, { status: 500 })
  }
}

// POST: Save a new report grouped under the user directory
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { reportName, userName, periods } = body

    if (!reportName || !userName || !periods) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
    }

    if (await reportNameExists(userName, reportName)) {
      return NextResponse.json(
        { success: false, error: "A report with this name already exists. Please choose another name." },
        { status: 409 },
      )
    }

    const { dir, slug } = await ensureUserDir(userName)
    const id = buildReportId(slug)
    const report = {
      id,
      reportName,
      userName,
      userSlug: slug,
      createdAt: new Date().toISOString(),
      periods,
    }

    await writeFile(join(dir, `${id}.json`), JSON.stringify(report, null, 2))

    return NextResponse.json({ success: true, id })
  } catch (error) {
    console.error("Error saving report:", error)
    return NextResponse.json({ success: false, error: "Failed to save report" }, { status: 500 })
  }
}
