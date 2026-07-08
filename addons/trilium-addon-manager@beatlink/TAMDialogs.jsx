// Full-screen dialog-style overlays: the promptOnUpdate keep-mine/use-new review, and the
// external-references-would-dangle warning shown before an uninstall.

import { useState } from "trilium:preact"
import { TamButton } from "TAMShared.jsx"

function PromptReview({ prompts, onResolve }) {
    const [decisions, setDecisions] = useState(
        Object.fromEntries(prompts.map(p => [p.noteLocalId, false]))
    )

    return (
        <div className="TAM-prompt-review">
            <h3>Update Review</h3>
            <p>The following files were updated. Choose which version to keep for each:</p>
            {prompts.map(prompt => (
                <div key={prompt.noteLocalId} className="TAM-prompt-item">
                    <h4>{prompt.title}</h4>
                    <div className="TAM-prompt-options">
                        <div
                            className={`TAM-prompt-option${!decisions[prompt.noteLocalId] ? " TAM-prompt-selected" : ""}`}
                            onClick={() => setDecisions({ ...decisions, [prompt.noteLocalId]: false })}
                        >
                            <label>Keep Mine</label>
                            <pre className="TAM-prompt-content">{prompt.currentContent}</pre>
                        </div>
                        <div
                            className={`TAM-prompt-option${decisions[prompt.noteLocalId] ? " TAM-prompt-selected" : ""}`}
                            onClick={() => setDecisions({ ...decisions, [prompt.noteLocalId]: true })}
                        >
                            <label>Use New Default</label>
                            <pre className="TAM-prompt-content">{prompt.newContent}</pre>
                        </div>
                    </div>
                </div>
            ))}
            <TamButton icon="bx bx-check" text="Apply" onClick={() => onResolve(decisions)} />
        </div>
    )
}

function ExternalReferenceWarning({ addonId, references, onProceed, onCancel }) {
    return (
        <div className="TAM-prompt-review">
            <h3>External References Found</h3>
            <p>
                The following note(s) outside of <strong>{addonId}</strong> reference note(s) that will
                be deleted. Uninstalling anyway will leave those relations pointing at a note that no
                longer exists.
            </p>
            <ul className="TAM-external-ref-list">
                {references.map((ref, i) => (
                    <li key={i}>
                        <strong>{ref.sourceTitle}</strong> —{" "}
                        <code>~{ref.relationName}</code> →{" "}
                        <strong>{ref.targetTitle}</strong>
                    </li>
                ))}
            </ul>
            <div className="TAM-validation-buttons">
                <TamButton className="btn-ghost" icon="bx bx-x" text="Cancel" onClick={onCancel} />
                <TamButton icon="bx bx-trash" text="Uninstall Anyway" onClick={onProceed} />
            </div>
        </div>
    )
}

module.exports = { PromptReview, ExternalReferenceWarning }
