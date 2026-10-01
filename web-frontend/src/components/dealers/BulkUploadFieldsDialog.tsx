import { useState } from 'react'
import { COLUMN_HELP, TEMPLATE_HEADER, isRequired } from '../../api/ingestion.template'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { humanizeEnum } from '../search/vehicle-format'

interface Props {
  open: boolean
  onClose: () => void
}

/** "fuel_type" -> "Fuel type", for reading; the code form beside it is what goes in the CSV header. */
function friendlyName(column: string): string {
  const words = humanizeEnum(column).toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function ColumnTable({ columns }: { columns: readonly string[] }) {
  return (
    <table className="upload-columns__table">
      <thead>
        <tr>
          <th scope="col">Column</th>
          <th scope="col">What to enter</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((column) => (
          <tr key={column}>
            <th scope="row">
              {friendlyName(column)}
              <code className="upload-columns__code">{column}</code>
            </th>
            <td>{COLUMN_HELP[column]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * The CSV columns, required ones first. The optional ones stay hidden until the
 * dealer asks for them: most files only need the required set, and a table of
 * forty-odd columns up front buries that.
 */
export function BulkUploadFieldsDialog({ open, onClose }: Props) {
  const [showOptional, setShowOptional] = useState(false)

  const required = TEMPLATE_HEADER.filter((column) => isRequired(column))
  const optional = TEMPLATE_HEADER.filter((column) => !isRequired(column))

  const close = () => {
    setShowOptional(false)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="CSV columns"
      size="lg"
      footer={<Button onClick={close}>Done</Button>}
    >
      <p className="dealer-muted">
        Your file needs a header row with these {required.length} columns. Common spellings
        are recognised automatically, so an export from your own system usually works unedited.
      </p>

      <h3 className="modal__subhead">Required columns</h3>
      <div className="upload-columns">
        <ColumnTable columns={required} />
      </div>

      <div className="modal__more">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showOptional}
          onClick={() => setShowOptional((v) => !v)}
        >
          {showOptional ? 'Hide optional columns' : `Optional columns (${optional.length})`}
        </Button>
      </div>

      {showOptional && (
        <>
          <h3 className="modal__subhead">Optional columns</h3>
          <p className="dealer-muted">
            Add any of these when you have the information. Leaving them out never causes a row
            to be rejected.
          </p>
          <div className="upload-columns">
            <ColumnTable columns={optional} />
          </div>
        </>
      )}
    </Modal>
  )
}
