import { NextResponse } from "next/server"
import { checkReportNameExists, createReport, listReportSummaries } from "@/lib/report-storage"

// GET: List all saved reports grouped by user
export async function GET() {
  try {
    const grouped = await listReportSummaries()
    return NextResponse.json({ success: true, reports: grouped })
  } catch (error) {
    console.error("Error reading reports:", error)
    const message = error instanceof Error ? error.message : "Failed to read reports"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
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

    if (await checkReportNameExists(userName, reportName)) {
      return NextResponse.json(
        { success: false, error: "A report with this name already exists. Please choose another name." },
        { status: 409 },
      )
    }

    const { id } = await createReport(reportName, userName, periods)

    return NextResponse.json({ success: true, id })
  } catch (error) {
    console.error("Error saving report:", error)
    const message = error instanceof Error ? error.message : "Failed to save report"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
