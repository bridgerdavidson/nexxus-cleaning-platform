type PointerDownOutsideEvent = CustomEvent<{ originalEvent: PointerEvent }>

/**
 * Guard for stacked Radix layers (dialog over sheet, confirm over dialog,
 * popover/select inside either). Radix can defer an outside-pointerdown to
 * the follow-up click; if the tap closed the top layer, by click time that
 * layer has popped off the stack and the layer underneath mistakes the same
 * tap for its own outside-dismiss and closes too (bites touch pointers in
 * particular). A pointerdown that originated inside ANY overlay layer must
 * never dismiss the layer below it, so prevent those; genuine overlay
 * clicks have no dialog/popper ancestor and still dismiss. Works even after
 * the top layer unmounts: the event target retains its detached ancestors.
 */
export function guardStackedDismiss(
  userHandler?: (event: PointerDownOutsideEvent) => void,
): (event: PointerDownOutsideEvent) => void {
  return (event) => {
    userHandler?.(event)
    const target = event.detail.originalEvent.target
    if (
      target instanceof Element &&
      target.closest('[role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper]')
    ) {
      event.preventDefault()
    }
  }
}
