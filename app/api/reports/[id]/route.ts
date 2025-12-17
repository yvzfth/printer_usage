import { NextResponse } from "next/server"
import { readFile, readdir, unlink, writeFile } from "fs/promises"
import { join } from "path"
import { existsSync } from "fs"

const STORAGE_PATH = join(process.cwd(), "storage", "reports")

function getSlugFromId(id: string) {
  return id.includes("__") ? id.split("__")[0] : null
}

function buildFilePath(id: string, slug?: string) {
  if (slug) {
    return join(STORAGE_PATH, slug, `${id}.json`)
  }
  return join(STORAGE_PATH, `${id}.json`)
}

async function resolveReportPath(id: string) {
  if (!existsSync(STORAGE_PATH)) {
    return null
  }
  const slug = getSlugFromId(id)
  if (slug) {
    const directPath = buildFilePath(id, slug)
    if (existsSync(directPath)) return directPath
  }

  const rootCandidate = buildFilePath(id)
  if (existsSync(rootCandidate)) return rootCandidate

  const entries = await readdir(STORAGE_PATH, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(STORAGE_PATH, entry.name, `${id}.json`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function reportNameExistsForUser(userName: string, reportName: string, excludeId?: string) {
  if (!existsSync(STORAGE_PATH)) {
    return false
  }
  const normalizedUser = userName.trim().toLowerCase()
  const normalizedName = reportName.trim().toLowerCase()
  const entries = await readdir(STORAGE_PATH, { withFileTypes: true })

  const checkFile = async (filePath: string) => {
    const content = await readFile(filePath, "utf-8")
    const data = JSON.parse(content)
    if (data?.id && data.id === excludeId) {
      return false
    }
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

// GET: Load a specific report
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const filePath = await resolveReportPath(id)

    if (!filePath) {
      return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 })
    }

    const content = await readFile(filePath, "utf-8")
    const report = JSON.parse(content)

    return NextResponse.json({ success: true, report })
  } catch (error) {
    console.error("Error loading report:", error)
    return NextResponse.json({ success: false, error: "Failed to load report" }, { status: 500 })
  }
}

// DELETE: Delete a specific report
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const filePath = await resolveReportPath(id)

    if (!filePath) {
      return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 })
    }

    await unlink(filePath)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting report:", error)
    return NextResponse.json({ success: false, error: "Failed to delete report" }, { status: 500 })
  }
}

// PUT: Overwrite an existing report file
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const filePath = await resolveReportPath(id)

    if (!filePath) {
      return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 })
    }

    const body = await request.json()
    const { reportName, userName, periods } = body

    if (!reportName || !userName || !periods) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
    }

    const existing = JSON.parse(await readFile(filePath, "utf-8"))
    const updated = {
      ...existing,
      reportName,
      userName,
      periods,
      updatedAt: new Date().toISOString(),
    }

    await writeFile(filePath, JSON.stringify(updated, null, 2))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error updating report:", error)
    return NextResponse.json({ success: false, error: "Failed to update report" }, { status: 500 })
  }
}

// PATCH: Rename a report without altering its saved periods
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const filePath = await resolveReportPath(id)

    if (!filePath) {
      return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 })
    }

    const body = await request.json()
    const { reportName, userName } = body

    if (!reportName || !userName) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
    }

    if (await reportNameExistsForUser(userName, reportName, id)) {
      return NextResponse.json(
        { success: false, error: "A report with this name already exists. Please choose another name." },
        { status: 409 },
      )
    }

    const existing = JSON.parse(await readFile(filePath, "utf-8"))
    const updated = {
      ...existing,
      reportName,
      userName,
      updatedAt: new Date().toISOString(),
    }

    await writeFile(filePath, JSON.stringify(updated, null, 2))

    return NextResponse.json({ success: true, report: updated })
  } catch (error) {
    console.error("Error renaming report:", error)
    return NextResponse.json({ success: false, error: "Failed to rename report" }, { status: 500 })
  }
}
