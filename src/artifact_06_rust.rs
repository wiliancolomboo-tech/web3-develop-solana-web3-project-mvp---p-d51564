use anchor_lang::prelude::*;

#[error_code]
pub enum UniVibeError {
    #[msg("Title string exceeds maximum length of 64 bytes.")]
    TitleTooLong,
    #[msg("Deadline must be positioned in the future.")]
    InvalidDeadline,
    #[msg("Escrow funding amount must be strictly greater than zero.")]
    ZeroAmount,
    #[msg("Current bounty status does not allow this state transition.")]
    InvalidStatusTransition,
    #[msg("Action triggered prior to deadline expiration.")]
    DeadlineNotPassed,
    #[msg("Deliverable hash cannot be empty or all-zero.")]
    InvalidDeliverableHash,
    #[msg("Contributor share basis points must be between 0 and 10,000.")]
    InvalidBasisPoints,
    #[msg("Signer does not possess authority for this action.")]
    Unauthorized,
    #[msg("Math calculation resulted in arithmetic overflow.")]
    ArithmeticOverflow,
}