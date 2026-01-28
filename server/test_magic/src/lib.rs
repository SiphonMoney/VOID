//! Simple test program for MagicBlock PER integration
//! Tests delegation and execution on PER

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
    msg,
    sysvar::Sysvar,
};

// Program ID - will be set after deployment
solana_program::declare_id!("3XBN19JZQfDngF9VXDZzpzx32Q8GWXU3xrC3mvEdedom");

entrypoint!(process_instruction);

// Instruction discriminators
const INITIALIZE: u8 = 0;
const INCREMENT: u8 = 1;
const GET_VALUE: u8 = 2;

/// Main entry point
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let instruction = instruction_data[0];

    match instruction {
        INITIALIZE => initialize(program_id, accounts)?,
        INCREMENT => increment(program_id, accounts)?,
        GET_VALUE => get_value(program_id, accounts)?,
        _ => return Err(ProgramError::InvalidInstructionData),
    }

    Ok(())
}

/// Initialize counter account
/// Accounts: [counter PDA, user, system_program]
fn initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    msg!("Initialize counter");

    let accounts_iter = &mut accounts.iter();
    let counter_account = next_account_info(accounts_iter)?;
    let user = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    // Verify user is signer
    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify counter PDA
    let (expected_pda, bump_seed) = Pubkey::find_program_address(
        &[b"counter"],
        program_id,
    );

    if counter_account.key != &expected_pda {
        return Err(ProgramError::InvalidAccountData);
    }

    // If account doesn't exist, create it
    if counter_account.lamports() == 0 {
        msg!("Creating counter account");
        
        // Calculate rent
        let rent = solana_program::rent::Rent::get()?;
        let rent_lamports = rent.minimum_balance(8);

        // Create account via CPI
        solana_program::program::invoke_signed(
            &solana_program::system_instruction::create_account(
                user.key,
                counter_account.key,
                rent_lamports,
                8,
                program_id,
            ),
            &[user.clone(), counter_account.clone(), system_program.clone()],
            &[&[b"counter", &[bump_seed]]],
        )?;
    }

    // Initialize counter to 0
    let mut data = counter_account.data.borrow_mut();
    if data.len() < 8 {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Store u64 value (8 bytes)
    let value: u64 = 0;
    data[0..8].copy_from_slice(&value.to_le_bytes());

    msg!("Counter initialized to 0");
    Ok(())
}

/// Increment counter
/// Accounts: [counter PDA]
fn increment(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    msg!("Increment counter");

    let accounts_iter = &mut accounts.iter();
    let counter_account = next_account_info(accounts_iter)?;

    // Read current value
    let mut data = counter_account.data.borrow_mut();
    if data.len() < 8 {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut value_bytes = [0u8; 8];
    value_bytes.copy_from_slice(&data[0..8]);
    let mut value = u64::from_le_bytes(value_bytes);

    // Increment
    value = value.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;

    // Write back
    data[0..8].copy_from_slice(&value.to_le_bytes());

    msg!("Counter incremented to {}", value);
    Ok(())
}

/// Get counter value (read-only)
/// Accounts: [counter PDA]
fn get_value(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    msg!("Get counter value");

    let accounts_iter = &mut accounts.iter();
    let counter_account = next_account_info(accounts_iter)?;

    let data = counter_account.data.borrow();
    if data.len() < 8 {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut value_bytes = [0u8; 8];
    value_bytes.copy_from_slice(&data[0..8]);
    let value = u64::from_le_bytes(value_bytes);

    msg!("Counter value: {}", value);
    Ok(())
}
