use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum BountyStatus {
    Created,
    Submitted,
    Disputed,
    Completed,
    Refunded,
}

#[account]
pub struct Bounty {
    /// Identifier seed
    pub bounty_id: u64,
    /// Creator and funder of the bounty
    pub sponsor: Pubkey,
    /// Selected student or research contributor
    pub contributor: Pubkey,
    /// Designated arbiter (e.g. KUBG committee lead)
    pub arbitrator: Pubkey,
    /// Locked payout amount in lamports
    pub amount: u64,
    /// Submission deadline unix epoch timestamp
    pub deadline_timestamp: i64,
    /// State machine lifecycle tracker
    pub status: BountyStatus,
    /// IPFS/Arweave SHA-256 hash of proof deliverable
    pub deliverable_hash: [u8; 32],
    /// PDA bump for the bounty account
    pub bump: u8,
    /// PDA bump for the lamport vault
    pub vault_bump: u8,
    /// Metadata human-readable title (max 64 chars)
    pub title: String,
}

impl Bounty {
    pub const LEN: usize = 8 +  // discriminator
        8 +                     // bounty_id (u64)
        32 +                    // sponsor (Pubkey)
        32 +                    // contributor (Pubkey)
        32 +                    // arbitrator (Pubkey)
        8 +                     // amount (u64)
        8 +                     // deadline_timestamp (i64)
        1 +                     // status (enum)
        32 +                    // deliverable_hash ([u8; 32])
        1 +                     // bump
        1 +                     // vault_bump
        4 + 64;                 // title (String up to 64 bytes)
}