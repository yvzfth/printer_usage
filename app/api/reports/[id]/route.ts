import { NextResponse } from "next/server"
import { readFile, readdir, unlink } from "fs/promises"
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
