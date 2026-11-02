use anchor_lang::prelude::*;

#[event]
pub struct BountyInitialized {
    pub bounty_id: u64,
    pub sponsor: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub deadline_timestamp: i64,
    pub title: String,
}

#[event]
pub struct MilestoneSubmitted {
    pub bounty_id: u64,
    pub contributor: Pubkey,
    pub deliverable_hash: [u8; 32],
    pub submitted_at: i64,
}

#[event]
pub struct FundsDisbursed {
    pub bounty_id: u64,
    pub contributor: Pubkey,
    pub amount: u64,
    pub disbursed_at: i64,
}

#[event]
pub struct DisputeResolved {
    pub bounty_id: u64,
    pub arbitrator: Pubkey,
    pub contributor_amount: u64,
    pub sponsor_amount: u64,
}

#[event]
pub struct TimeoutRefunded {
    pub bounty_id: u64,
    pub sponsor: Pubkey,
    pub amount: u64,
}