import { NextResponse } from "next/server"
import {
  checkReportNameExists,
  deleteReportById,
  getReportById,
  overwriteReport,
} from "@/lib/report-storage"

// GET: Load a specific report
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const report = await getReportById(id)
    if (!report) {
      return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 })
    }

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
    const report = await getReportById(id)
    if (!report) {
      return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 })
    }

    await deleteReportById(id)
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
    const existing = await getReportById(id)
    if (!existing) {
      return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 })
    }

    const body = await request.json()
    const { reportName, userName, periods } = body

    if (!reportName || !userName || !periods) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
    }

    const updated = await overwriteReport(id, { reportName, userName, periods })
    if (!updated) {
      return NextResponse.json({ success: false, error: "Failed to update report" }, { status: 500 })
    }

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
    const existing = await getReportById(id)
    if (!existing) {
      return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 })
    }

    const body = await request.json()
    const { reportName, userName } = body

    if (!reportName || !userName) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
    }

    if (await checkReportNameExists(userName, reportName, id)) {
      return NextResponse.json(
        { success: false, error: "A report with this name already exists. Please choose another name." },
        { status: 409 },
      )
    }

    const updated = await overwriteReport(id, { reportName, userName })
    if (!updated) {
      return NextResponse.json({ success: false, error: "Failed to rename report" }, { status: 500 })
    }

    return NextResponse.json({ success: true, report: updated })
  } catch (error) {
    console.error("Error renaming report:", error)
    return NextResponse.json({ success: false, error: "Failed to rename report" }, { status: 500 })
  }
}
