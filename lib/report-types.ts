export type PeriodKey = string
export type UserKey = string

export type Totals = {
  mono: number
  color: number
  blank: number
  total: number
  adobePdf: number
  copy: number
  msExcel: number
  msPowerPoint: number
  msWord: number
  simplex: number
  duplex: number
  otherApplication: number
  print: number
}

export type PrinterUsage = {
  deviceModel: string
  ipHostname: string
  ipAddress: string
  totals: Totals
}

export type UserData = {
  totals: Totals
  printerUsage: PrinterUsage[]
}

export type ReportPeriod = {
  id: PeriodKey
  fileName: string
  dateCreated?: Date
  rangeStart?: Date
  rangeEnd?: Date
  periodLabel: string
  users: Record<UserKey, UserData>
  grandTotals: Totals
}

export type SavedReport = {
  id: string
  reportName: string
  userName: string
  createdAt: string
  periods: ReportPeriod[]
}
