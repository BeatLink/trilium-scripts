// Pure presentation, no relation resolution — dependency injection, like
// every other lib*@beatlink component. The caller supplies already-fetched
// title/prefix/color per note and wires onClick to however it wants to
// navigate there (e.g. trilium:api's activateNote).
export function TaskCard({
    noteId,
    title,
    prefix,
    color,
    onClick,
    draggable = false,
    onDragStart,
    onDragEnd
}) {
    return (
        <div
            className="libagendataskcard"
            style={color ? { borderLeftColor: color } : undefined}
            onClick={() => onClick?.(noteId)}
            draggable={draggable}
            onDragStart={draggable ? (e => onDragStart?.(e, noteId)) : undefined}
            onDragEnd={draggable ? (e => onDragEnd?.(e, noteId)) : undefined}
        >
            {prefix && <span className="libagendataskcard-prefix">{prefix}</span>}
            <span className="libagendataskcard-title">{title}</span>
        </div>
    )
}
