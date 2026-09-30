/**
 * Vetting Notepad — Chrome Extension Controller
 * Ultra-compact, fast, KISS, lightweight.
 */
(() => {
'use strict';

const uid = () => Math.random().toString(36).slice(2, 8);

const Storage = {
  async get(key, fallback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const res = await chrome.storage.local.get(key);
        return res[key] !== undefined ? res[key] : fallback;
      } catch (e) {
        return fallback;
      }
    }
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  async set(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set({ [key]: value });
        return;
      } catch (e) {}
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  },
  async setMultiple(obj) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set(obj);
        return;
      } catch (e) {}
    }
    try {
      for (const [k, v] of Object.entries(obj)) {
        localStorage.setItem(k, JSON.stringify(v));
      }
    } catch (e) {}
  }
};

function defaultVettingTypes() {
  return [
  {
    "id": "swap",
    "name": "SIM Swap (Enhanced Vetting)",
    "article": "SSCB-0006",
    "minSecondary": 2,
    "required": [
      {
        "id": "sw_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA SCEK-0002 / SSCB-0006]\nCalling number must be active on IN-Data. Maximum 2 swap requests per 24 hours."
      },
      {
        "id": "sw_msisdn",
        "label": "Line to Swap",
        "len": 10,
        "info": "[SAKA SSCB-0006]\nMust be active on CBS, not pooled/deleted, not self-whitelisted (*100*100#). Line must be off or verified."
      },
      {
        "id": "sw_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nFull names as registered on View 360. Must completely match registration."
      },
      {
        "id": "sw_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nOriginal registered document number. Leading zeros do not invalidate ID."
      },
      {
        "id": "sw_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth as per View 360 & Siebel records."
      },
      {
        "id": "sw_simex",
        "label": "New SIMEX Serial",
        "len": 20,
        "info": "[SAKA SSCB-0006]\n20-digit serial number from replacement SIM card retailing at KES 100."
      }
    ],
    "optional": [
      {
        "id": "sw_fdn1",
        "label": "FDN 1 // 2x in 3 mos",
        "len": 10,
        "group": "fdn",
        "info": "[SAKA VMDA-0001]\nFrequently Dialled Number: Must be Mobile Originated (MO) call or SMS at least twice in the last 3 months. FDN 1 & 2 together count as 1 pass."
      },
      {
        "id": "sw_fdn2",
        "label": "FDN 2 // 2x in 3 mos",
        "len": 10,
        "group": "fdn",
        "info": "[SAKA VMDA-0001]\nSecond Frequently Dialled Number. Together with FDN 1 counts as 1 secondary pass."
      },
      {
        "id": "sw_mpesa_bal",
        "label": "M-PESA Balance // SAKA Margins",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nAllowed margins:\n\u2022 1 \u2013 100: \u00b110\n\u2022 101 \u2013 1,000: \u00b150\n\u2022 1,001 \u2013 10,000: \u00b1100\n\u2022 > 10,001: \u00b110%"
      },
      {
        "id": "sw_airtime_bal",
        "label": "Airtime Balance",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nCurrent airtime balance on CBS IN-Data."
      },
      {
        "id": "sw_mpesa_txn1",
        "label": "Self-Txn 1 // Last 30d",
        "len": 0,
        "group": "self_txn",
        "info": "[SAKA VMDA-0001]\nSelf-initiated M-PESA transaction from customer account in last 30 days. Must provide Amount, Date/Time, and Recipient name. (2 txns count as 1 pass)."
      },
      {
        "id": "sw_mpesa_txn2",
        "label": "Self-Txn 2 // Last 30d",
        "len": 0,
        "group": "self_txn",
        "info": "[SAKA VMDA-0001]\nSecond self-initiated M-PESA transaction in last 30 days."
      },
      {
        "id": "sw_limit",
        "label": "Loan Limit // Fuliza & M-Shwari",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nAccurate loan/overdraft limit required. Do NOT use if customer has not opted in."
      },
      {
        "id": "sw_regdate",
        "label": "Registration Date // Month & Year",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nMonth and Year of Line registration or M-PESA registration."
      },
      {
        "id": "sw_bundle",
        "label": "Last Bundle Purchase",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nCustomer to provide bundle name or price purchased."
      },
      {
        "id": "sw_altno",
        "label": "Alternative Number",
        "len": 10,
        "info": "[SAKA SSCB-0006]\n10-digit alternative contact number."
      }
    ],
    "comments": [
      "Customer vetted on primary and secondary details. Line swapped successfully. Educated on M-PESA activation.",
      "Customer failed secondary vetting. Advised to verify account details and call back.",
      "Line self-whitelisted (*100*100#). Advised customer to visit Retail Center with original ID.",
      "Line swapped in last 72 hours. Declined and referred to Retail as per policy."
    ]
  },
  {
    "id": "reversal",
    "name": "M-PESA & Airtime Reversal",
    "article": "MRMM-0003",
    "required": [
      {
        "id": "rev_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA MRMM-0003]\nMandatory calling number. If calling on behalf, capture caller number on interaction."
      },
      {
        "id": "rev_tid",
        "label": "Transaction ID",
        "len": 10,
        "info": "[SAKA MRMM-0003]\n10-character alphanumeric transaction reference (e.g. TGI7...)."
      },
      {
        "id": "rev_sender_msisdn",
        "label": "Sender Number",
        "len": 10,
        "info": "[SAKA MRMM-0003]\nMSISDN of the person who initiated the transaction."
      },
      {
        "id": "rev_sender_name",
        "label": "Sender Name // 2 Names",
        "len": 0,
        "info": "[SAKA MRMM-0003]\nConfirm ownership using Customer Name as per M-PESA G3. Accept if customer gives 2 correct names. (No ID/YOB required for P2P reversal)."
      },
      {
        "id": "rev_amount",
        "label": "Amount",
        "len": 0,
        "info": "[SAKA MRMM-0003]\nExact amount sent in the transaction."
      },
      {
        "id": "rev_recipient",
        "label": "Recipient Number / Till",
        "len": 10,
        "info": "[SAKA MRMM-0003 / LBCF-0003]\nParty B phone number, Buy Goods Till number, or Paybill business number."
      },
      {
        "id": "rev_date_time",
        "label": "Date & Time // <30 days",
        "len": 0,
        "info": "[SAKA MRMM-0003 / MALP-0001]\nTransaction must be within last 30 days for M-PESA P2P, or within 48h for M-PESA airtime reversal. If >30 days, advise customer to liaise with recipient/police."
      }
    ],
    "optional": [
      {
        "id": "rev_type",
        "label": "Reversal Type",
        "len": 0,
        "info": "[SAKA MRMM-0003]\nSpecify transaction type: P2P, LNM Till, Paybill 200200, Pochi la Biashara, or Airtime Purchase."
      },
      {
        "id": "rev_wrong_acc",
        "label": "Wrong Account / Ref",
        "len": 0,
        "info": "[SAKA LBCF-0003]\nWrong account or reference number keyed in (for Paybill/LNM)."
      },
      {
        "id": "rev_correct_acc",
        "label": "Correct Account",
        "len": 0,
        "info": "[SAKA LBCF-0003]\nIntended correct account or phone number."
      },
      {
        "id": "rev_recipient_airtime",
        "label": "Recipient Airtime Bal",
        "len": 0,
        "info": "[SAKA MALP-0001]\nFor airtime reversal: Recipient must have sufficient balance equal to or greater than amount purchased. Partial airtime reversal not possible."
      },
      {
        "id": "rev_sr_num",
        "label": "SR Number // 72h SLA",
        "len": 0,
        "info": "[SAKA LBCF-0003 / LPPP-0014]\nService Request number if escalated to LNM/Aggregator/Postpay team (72h SLA). Normal P2P SLA is 2 hours."
      }
    ],
    "comments": [
      "P2P reversal initiated on G3. Verified sender names and transaction within 30 days. Advised on 2h SLA.",
      "LNM Reversal requested. Verified transaction details. Escalated to LNM Support via SR, advised on 72h SLA.",
      "Airtime reversal processed on CRM. Recipient airtime balance verified. Advised customer.",
      "Transaction older than 30 days. Advised customer to liaise directly with recipient or police.",
      "Funds already utilized by recipient. Advised sender to engage recipient or report to police."
    ]
  },
  {
    "id": "bar_self",
    "name": "Line Barring (Owner Calling)",
    "article": "BADD-0003",
    "required": [
      {
        "id": "bar_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA BADD-0003]\nCalling number must be captured on interactions."
      },
      {
        "id": "bar_msisdn",
        "label": "Line to Bar",
        "len": 10,
        "info": "[SAKA BADD-0003]\nMobile number to be suspended/barred."
      },
      {
        "id": "bar_reason",
        "label": "Reason // Misplaced/Stolen",
        "len": 0,
        "info": "[SAKA BADD-0003]\nClarify if phone is misplaced or stolen. If stolen, categorized as fraud: Siebel Key Comment MUST be updated: \"Phone stolen, Refer to Retail for Unbarring\"."
      },
      {
        "id": "bar_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nFull names as registered on View 360."
      },
      {
        "id": "bar_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nOriginal registered document number."
      },
      {
        "id": "bar_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth of the registered owner."
      }
    ],
    "optional": [
      {
        "id": "bar_siebel_suspend",
        "label": "Siebel Status // Suspended",
        "len": 0,
        "info": "[SAKA BADD-0003]\nSet Siebel status to \"Suspended\" > Action reason \"Suspend \u2013 Handset Lost/Stolen\" or \"Suspend All Customer request\"."
      },
      {
        "id": "bar_hlr_sawa",
        "label": "HLR Status // BAOC/BAIC",
        "len": 0,
        "info": "[SAKA BADD-0003]\nConfirm BAOC reads OC and BAIC reads IC. If not successful, suspend on HLR under supplementary services > BAR Lost line."
      },
      {
        "id": "bar_g3_status",
        "label": "M-PESA G3 Status // Barred",
        "len": 0,
        "info": "[SAKA BADD-0003]\nBar on M-PESA G3 to secure money in customer wallet."
      },
      {
        "id": "bar_apps_wiped",
        "label": "Apps Wiped // CRM",
        "len": 0,
        "info": "[SAKA BADD-0003]\nCEE must wipe out mySafaricom App, MyOne App, and M-PESA Apps on CRM."
      },
      {
        "id": "bar_altno",
        "label": "Alternative Number",
        "len": 10,
        "info": "[SAKA BADD-0003]\nAlternative reachable number."
      }
    ],
    "comments": [
      "Phone reported misplaced. Line suspended on Siebel & HLR, M-PESA barred on G3, apps wiped on CRM.",
      "Phone reported stolen. Line barred, apps wiped, key comment added: \"Phone stolen, Refer to Retail for Unbarring\".",
      "Customer vetted on primary details. Temporary barring placed at customer request."
    ]
  },
  {
    "id": "bar_thirdparty",
    "name": "Line Barring (3rd Party Calling)",
    "article": "BADD-0003",
    "required": [
      {
        "id": "bar3_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA IDPA-0001 / BADD-0003]\nCapture interaction on third-party number with action \"Calling on Customer Behalf\", and log second interaction on affected line."
      },
      {
        "id": "bar3_caller_name",
        "label": "Caller Name",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nFull names of the person calling on behalf of the owner."
      },
      {
        "id": "bar3_caller_id",
        "label": "Caller ID",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nNational ID or passport number of the third party."
      },
      {
        "id": "bar3_msisdn",
        "label": "Line to Bar",
        "len": 10,
        "info": "[SAKA BADD-0003]\nMobile number of the lost/stolen line to be barred."
      },
      {
        "id": "bar3_reason",
        "label": "Reason // Misplaced/Stolen",
        "len": 0,
        "info": "[SAKA BADD-0003]\nReason line is being barred. If stolen, must add key comment \"Phone stolen, Refer to Retail for Unbarring\"."
      },
      {
        "id": "bar3_owner_names",
        "label": "Owner Name // 2 Names",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nRequest registered customer's 2 names (e.g. first and last name)."
      },
      {
        "id": "bar3_owner_id",
        "label": "Owner ID",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nRegistered customer's ID number. (Note: Owner Year of Birth is NOT requested from 3rd party)."
      }
    ],
    "optional": [
      {
        "id": "bar3_siebel_suspend",
        "label": "Siebel Status // Suspended",
        "len": 0,
        "info": "[SAKA BADD-0003]\nSuspend on Siebel & CRM."
      },
      {
        "id": "bar3_hlr_sawa",
        "label": "HLR Status // BAOC/BAIC",
        "len": 0,
        "info": "[SAKA BADD-0003]\nConfirm outgoing & incoming calls barred on HLR."
      },
      {
        "id": "bar3_g3_status",
        "label": "M-PESA G3 Status // Barred",
        "len": 0,
        "info": "[SAKA BADD-0003]\nBar M-PESA wallet on G3."
      },
      {
        "id": "bar3_apps_wiped",
        "label": "Apps Wiped // CRM",
        "len": 0,
        "info": "[SAKA BADD-0003]\nWipe all linked apps on CRM."
      }
    ],
    "comments": [
      "Third party called to report lost phone. Captured caller details and vetted registered owner. Line barred, apps wiped.",
      "Third party reported stolen phone. Line barred, apps wiped, key comment updated: \"Phone stolen, Refer to Retail for Unbarring\".",
      "Third party failed owner verification details. Barring declined; advised owner to call or visit shop."
    ]
  },
  {
    "id": "unbar",
    "name": "Line Unbarring (Self Only)",
    "article": "BADD-0003",
    "minSecondary": 2,
    "required": [
      {
        "id": "unb_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA BADD-0003]\nCalling number must be active on IN-Data."
      },
      {
        "id": "unb_msisdn",
        "label": "Line to Unbar",
        "len": 10,
        "info": "[SAKA BADD-0003]\nLine to be resumed/unbarred. Self only! Third parties cannot unbar a line."
      },
      {
        "id": "unb_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nFull names as registered on View 360."
      },
      {
        "id": "unb_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nOriginal registered document number."
      },
      {
        "id": "unb_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth of line owner."
      }
    ],
    "optional": [
      {
        "id": "unb_check_keycom",
        "label": "Siebel Comments // Clean Tag",
        "len": 0,
        "info": "[SAKA BADD-0003]\nCRITICAL PRE-CHECK: Check Siebel key comments. If comment reads \"Phone stolen, Refer to Retail for Unbarring\", line can ONLY be unbarred at Retail. Do NOT unbar at Call Center!"
      },
      {
        "id": "unb_fdn1",
        "label": "FDN 1 // 2x in 3 mos",
        "len": 10,
        "group": "fdn",
        "info": "[SAKA VMDA-0001]\nFrequently Dialled Number: MO call/SMS 2x in last 3 months."
      },
      {
        "id": "unb_fdn2",
        "label": "FDN 2 // 2x in 3 mos",
        "len": 10,
        "group": "fdn",
        "info": "[SAKA VMDA-0001]\nSecond FDN. FDN 1 & 2 together count as 1 pass."
      },
      {
        "id": "unb_mpesa_bal",
        "label": "M-PESA Balance // SAKA Margins",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nAllowed margins:\n\u2022 1 \u2013 100: \u00b110\n\u2022 101 \u2013 1,000: \u00b150\n\u2022 1,001 \u2013 10,000: \u00b1100\n\u2022 > 10,001: \u00b110%"
      },
      {
        "id": "unb_airtime_bal",
        "label": "Airtime Balance",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nAirtime balance on CBS IN-Data."
      },
      {
        "id": "unb_mpesa_txn1",
        "label": "Self-Txn 1 // Last 30d",
        "len": 0,
        "group": "self_txn",
        "info": "[SAKA BADD-0003 / VMDA-0001]\nSelf-initiated M-PESA transaction from customer account in last 30 days. Must provide Amount, Date/Time, and Recipient name. (2 txns count as 1 pass)."
      },
      {
        "id": "unb_mpesa_txn2",
        "label": "Self-Txn 2 // Last 30d",
        "len": 0,
        "group": "self_txn",
        "info": "[SAKA BADD-0003 / VMDA-0001]\nSecond self-initiated M-PESA transaction in last 30 days."
      },
      {
        "id": "unb_limit",
        "label": "Loan Limit // Fuliza & M-Shwari",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nOpted-in FSI limit."
      },
      {
        "id": "unb_regdate",
        "label": "Registration Date // Month & Year",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nMonth and Year of registration."
      },
      {
        "id": "unb_hlr_resume",
        "label": "HLR & Siebel Resumed // PIN 0000",
        "len": 0,
        "info": "[SAKA BADD-0003]\nLine resumed on Siebel & HLR operator barring cleared. Advise customer on default barring PIN 0000."
      }
    ],
    "comments": [
      "Vetted for line unbarring. Siebel checked (no fraud tag), line resumed and HLR cleared. Advised on PIN 0000.",
      "Siebel key comment reads \"Phone stolen\". Advised customer line can only be unbarred at Retail with original ID.",
      "Customer failed secondary vetting for unbarring. Advised to confirm account details and call back."
    ]
  },
  {
    "id": "pin_unlock",
    "name": "M-PESA PIN Unlock (Locked PIN)",
    "article": "SKKI-0001",
    "required": [
      {
        "id": "pinu_callno",
        "label": "Calling Number // Active IN",
        "len": 10,
        "info": "[SAKA SKKI-0001]\nProceed only if calling number is a Safaricom number in Active or Expiry state on IN-Data."
      },
      {
        "id": "pinu_msisdn",
        "label": "Affected M-PESA Line",
        "len": 10,
        "info": "[SAKA SKKI-0001]\nM-PESA account locked due to wrong PIN attempts."
      },
      {
        "id": "pinu_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA SKKI-0001]\nFull names must tally on View 360 and M-PESA G3. If mismatch, refer to Retail."
      },
      {
        "id": "pinu_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA SKKI-0001]\nDocument ID used to register M-PESA. If 7-digit ID, assist and advise how ID appears on G3."
      },
      {
        "id": "pinu_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth."
      }
    ],
    "optional": [
      {
        "id": "pinu_g3_action",
        "label": "Unlock Action // G3",
        "len": 0,
        "info": "[SAKA SKKI-0001]\nGo to Customer Info page on G3 > click \"Unlock PIN\" icon > enter reason & vetting details > submit & confirm. Advise customer to use correct PIN."
      },
      {
        "id": "pinu_diy_advice",
        "label": "DIY Education // *334#",
        "len": 0,
        "info": "[SAKA SKKI-0001]\nEducate on DIY: *334# > My Account > Unlock M-PESA PIN, or M-PESA App, or IVR 100."
      },
      {
        "id": "pinu_altno",
        "label": "Alternative Number",
        "len": 10,
        "info": "[SAKA SKKI-0001]\nAlternative reachable number."
      }
    ],
    "comments": [
      "Customer vetted on primary details. M-PESA PIN unlocked on G3. Guided on DIY *334# for self-service.",
      "Account unlocked on G3. Advised customer to wait for SMS and use correct PIN to transact.",
      "Customer failed primary vetting. Advised to confirm registration details and call back or visit shop."
    ]
  },
  {
    "id": "startkey",
    "name": "M-PESA Start Key / Forgotten PIN",
    "article": "SKKI-0001",
    "minSecondary": 2,
    "required": [
      {
        "id": "sk_callno",
        "label": "Calling Number // Active IN",
        "len": 10,
        "info": "[SAKA SKKI-0001]\nMust be a Safaricom number active on IN-Data. Calling on behalf: CEE can only give Start Key DIY."
      },
      {
        "id": "sk_msisdn",
        "label": "Affected M-PESA Line",
        "len": 10,
        "info": "[SAKA SKKI-0001]\nCustomer forgot M-PESA PIN and needs Start Key to reset."
      },
      {
        "id": "sk_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA SKKI-0001]\nFull names as registered on View 360 & G3."
      },
      {
        "id": "sk_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA SKKI-0001]\nDocument number of registration."
      },
      {
        "id": "sk_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth."
      }
    ],
    "optional": [
      {
        "id": "sk_rule_24h_txn",
        "label": "24h Auth Txn // Retail if Yes",
        "len": 0,
        "info": "[SAKA SKKI-0001]\nCRITICAL FRAUD CHECK: Check if customer had a positive PIN-authenticated transaction in last 24h (Send Money, Paybill, Airtime, Bal Check). If YES, REFER CUSTOMER TO RETAIL! Do not issue Start Key at Contact Center."
      },
      {
        "id": "sk_rule_24h_swap",
        "label": "24h Swap Check // 24h Policy",
        "len": 0,
        "info": "[SAKA SKKI-0001]\nIf SIM replacement was done within 24h, customer must wait until 24h elapses or visit shop. (Note: DIY PIN reset after SIM swap is available after 7 days, not 24h)."
      },
      {
        "id": "sk_fdn1",
        "label": "FDN 1 // 2x in 3 mos",
        "len": 10,
        "group": "fdn",
        "info": "[SAKA VMDA-0001]\nFrequently Dialled Number: MO call/SMS 2x in last 3 months."
      },
      {
        "id": "sk_fdn2",
        "label": "FDN 2 // 2x in 3 mos",
        "len": 10,
        "group": "fdn",
        "info": "[SAKA VMDA-0001]\nSecond FDN."
      },
      {
        "id": "sk_mpesa_bal",
        "label": "M-PESA Balance // SAKA Margins",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nAllowed margins:\n\u2022 1 \u2013 100: \u00b110\n\u2022 101 \u2013 1,000: \u00b150\n\u2022 1,001 \u2013 10,000: \u00b1100\n\u2022 > 10,001: \u00b110%"
      },
      {
        "id": "sk_airtime_bal",
        "label": "Airtime Balance",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nCurrent airtime balance."
      },
      {
        "id": "sk_mpesa_txn1",
        "label": "Self-Txn 1 // Last 30d",
        "len": 0,
        "group": "self_txn",
        "info": "[SAKA SKKI-0001 / VMDA-0001]\nSelf-initiated M-PESA transaction from customer account in last 30 days. Must provide Amount, Date/Time, and Recipient name. (2 txns count as 1 pass)."
      },
      {
        "id": "sk_mpesa_txn2",
        "label": "Self-Txn 2 // Last 30d",
        "len": 0,
        "group": "self_txn",
        "info": "[SAKA SKKI-0001 / VMDA-0001]\nSecond self-initiated M-PESA transaction in last 30 days."
      },
      {
        "id": "sk_limit",
        "label": "Loan Limit // Fuliza & M-Shwari",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nOpted-in FSI limit."
      },
      {
        "id": "sk_regdate",
        "label": "Registration Date // Month & Year",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nMonth and Year of M-PESA or line registration."
      },
      {
        "id": "sk_sec_questions",
        "label": "Security Questions Guided",
        "len": 0,
        "info": "[SAKA SKKI-0001]\nEducate customer to set security questions: *334# > My Account > M-PESA PIN Manager > Set Security Questions."
      }
    ],
    "comments": [
      "Vetted on primary and secondary details. Start Key issued on G3. Educated on *334# PIN reset.",
      "Positive authenticated PIN txn in last 24h. Referred customer to Retail Center as per fraud policy.",
      "SIM replacement done within 24h. Advised customer to call back after 24h or visit shop.",
      "Educated customer on setting M-PESA security questions on *334# for future DIY PIN resets."
    ]
  },
  {
    "id": "puk",
    "name": "PUK Retrieval",
    "article": "PUDA-0004",
    "required": [
      {
        "id": "puk_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA PUDA-0004]\nCalling number querying PUK."
      },
      {
        "id": "puk_msisdn",
        "label": "Line Needing PUK",
        "len": 10,
        "info": "[SAKA PUDA-0004]\nBlocked MSISDN requiring PUK1 or PUK2."
      },
      {
        "id": "puk_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nFull names as registered on View 360."
      },
      {
        "id": "puk_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nOriginal registered document ID number."
      },
      {
        "id": "puk_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth."
      }
    ],
    "optional": [
      {
        "id": "puk_crm_sms",
        "label": "PUK Sent via SMS // With consent",
        "len": 0,
        "info": "[SAKA PUDA-0004]\nCEE must send SMS with PUK to the calling number via CRM SMS tool at end of call after obtaining customer consent."
      },
      {
        "id": "puk_sim_serial",
        "label": "SIM Serial Check",
        "len": 0,
        "info": "[SAKA PUDA-0004]\nRepeat caller check: If customer says PUK is not working, verify physical SIM serial against CRM. If mismatch, advise on SIM replacement."
      },
      {
        "id": "puk_diy_sms",
        "label": "DIY Education // *100#",
        "len": 0,
        "info": "[SAKA PUDA-0004]\nAdvise on DIY: Dial *100# from another line or visit safaricomapp.page.link/get-puk."
      },
      {
        "id": "puk_altno",
        "label": "Alternative Number",
        "len": 10,
        "info": "[SAKA PUDA-0004]\nAlternative contact number."
      }
    ],
    "comments": [
      "PUK issued after primary vetting. Sent PUK via CRM SMS with customer consent. Educated on DIY *100#.",
      "Repeat caller for PUK not working. SIM serial verified on CRM. Advised customer to test on another handset or swap.",
      "SIM damaged after 10 incorrect PUK attempts. Advised customer on SIM replacement at shop."
    ]
  },
  {
    "id": "sim_upgrade",
    "name": "SIM Upgrade (Calling from Line)",
    "article": "VMDA-0001",
    "required": [
      {
        "id": "upg_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA VMDA-0001 / SCEK-0002]\nCustomer is calling directly from the active line being upgraded to 4G/5G. SAKA VMDA-0001: Basic Vetting only!"
      },
      {
        "id": "upg_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nFull names as registered on View 360."
      },
      {
        "id": "upg_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nRegistered document number."
      },
      {
        "id": "upg_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth."
      },
      {
        "id": "upg_simex",
        "label": "New SIMEX Serial",
        "len": 20,
        "info": "[SAKA SSCB-0006]\n20-digit serial number from the new 4G/5G upgrade SIM card."
      }
    ],
    "optional": [
      {
        "id": "upg_call_drop",
        "label": "Call Drop Advised",
        "len": 0,
        "info": "[SAKA SSCB-0006]\nAdvise customer that the active call will drop immediately once the SIM upgrade order is submitted on View 360."
      },
      {
        "id": "upg_mpesa_reactivate",
        "label": "M-PESA Activation Advised",
        "len": 0,
        "info": "[SAKA MABN-0001]\nAdvise customer on M-PESA activation process after inserting new SIM."
      },
      {
        "id": "upg_altno",
        "label": "Alternative Number",
        "len": 10,
        "info": "[SAKA SSCB-0006]\nAlternative number in case follow-up is needed."
      }
    ],
    "comments": [
      "SIM upgrade processed for active line. Customer advised on call drop and M-PESA reactivation.",
      "Customer vetted for SIM upgrade (4G/5G). Order submitted on View 360 with new SIMEX serial."
    ]
  },
  {
    "id": "pooled",
    "name": "Pooled Number Recreation",
    "article": "SRFB-0005",
    "required": [
      {
        "id": "pol_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA SRFB-0005]\nCalling number of the previous owner."
      },
      {
        "id": "pol_msisdn",
        "label": "Pooled Line Number",
        "len": 10,
        "info": "[SAKA SRFB-0005]\nIndividual normal line in pool (not golden lines; golden lines refer to Retail). Only previous owner can recreate."
      },
      {
        "id": "pol_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA SRFB-0005]\nFull names as per View 360. CEE can accept 2 correct names."
      },
      {
        "id": "pol_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA SRFB-0005]\nID document number of the registered previous owner."
      },
      {
        "id": "pol_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth as registered."
      },
      {
        "id": "pol_old_simex",
        "label": "Old SIMEX Serial // Match CRM",
        "len": 20,
        "info": "[SAKA SRFB-0005]\nMandatory: Customer must provide the old SIM serial that was attached to the line; must match CRM records."
      }
    ],
    "optional": [
      {
        "id": "pol_indata_check",
        "label": "IN-Data Status // Pooled",
        "len": 0,
        "info": "[SAKA SRFB-0005]\nCheck IN-Data on CRM to confirm status is Pooled. If no details on View 360 but on CRM & G3, refer to Retail."
      },
      {
        "id": "pol_new_simex",
        "label": "New SIMEX Serial",
        "len": 20,
        "info": "[SAKA SRFB-0005]\nNew SIM replacement card serial if doing immediate swap."
      },
      {
        "id": "pol_sr_ticket",
        "label": "SR Number",
        "len": 0,
        "info": "[SAKA SRFB-0005]\nService Request number if line recreation requires back-office sync."
      },
      {
        "id": "pol_altno",
        "label": "Alternative Number",
        "len": 10,
        "info": "[SAKA SRFB-0005]\nAlternative reachable number."
      }
    ],
    "comments": [
      "Pooled line recreation vetted and processed on CRM. Old SIMEX serial matched system records.",
      "Line status confirmed pooled on IN-Data. Order submitted and escalated via SR for sync.",
      "Special number recreation requested. Advised customer that special and golden numbers are handled at Retail."
    ]
  },
  {
    "id": "mpesa_suspend",
    "name": "M-PESA Account Suspend",
    "article": "VMDA-0001",
    "required": [
      {
        "id": "mps_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA VMDA-0001]\nCalling number requesting suspension."
      },
      {
        "id": "mps_msisdn",
        "label": "M-PESA Line to Suspend",
        "len": 10,
        "info": "[SAKA VMDA-0001]\nM-PESA account to be suspended."
      },
      {
        "id": "mps_reason",
        "label": "Reason for Suspension",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nLost phone, suspected fraud, customer request, or dispute."
      },
      {
        "id": "mps_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nFull names as registered."
      },
      {
        "id": "mps_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nRegistered ID document number."
      },
      {
        "id": "mps_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth."
      }
    ],
    "optional": [
      {
        "id": "mps_g2_status",
        "label": "G3 Status // Suspended",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nSuspend account on M-PESA G3."
      },
      {
        "id": "mps_state_tag",
        "label": "State Tag Applied",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nApply state tag if required by fraud guidelines."
      },
      {
        "id": "mps_altno",
        "label": "Alternative Number",
        "len": 10,
        "info": "[SAKA VMDA-0001]\nAlternative contact number."
      }
    ],
    "comments": [
      "M-PESA account suspended on G3 at customer request following lost device.",
      "Suspected fraud reported. M-PESA account suspended and fraud state tag applied."
    ]
  },
  {
    "id": "mpesa_unsuspend",
    "name": "M-PESA Account Unsuspend",
    "article": "VMDA-0001",
    "minSecondary": 2,
    "required": [
      {
        "id": "mpu_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA VMDA-0001]\nCalling number requesting unsuspension."
      },
      {
        "id": "mpu_msisdn",
        "label": "M-PESA Line to Unsuspend",
        "len": 10,
        "info": "[SAKA VMDA-0001]\nCustomer had requested suspension and now wants it lifted."
      },
      {
        "id": "mpu_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nFull names as registered on View 360 & G3."
      },
      {
        "id": "mpu_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nDocument ID used to register M-PESA."
      },
      {
        "id": "mpu_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth."
      }
    ],
    "optional": [
      {
        "id": "mpu_fraud_tag_check",
        "label": "Fraud Tag Check // No fraud tag",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nLines suspended due to fraud tag or civil court cases CANNOT be unsuspended at Call Center. Refer to Safaricom Risk HQ1."
      },
      {
        "id": "mpu_fdn1",
        "label": "FDN 1 // 2x in 3 mos",
        "len": 10,
        "group": "fdn",
        "info": "[SAKA VMDA-0001]\nFrequently Dialled Number: MO call/SMS 2x in last 3 months."
      },
      {
        "id": "mpu_fdn2",
        "label": "FDN 2 // 2x in 3 mos",
        "len": 10,
        "group": "fdn",
        "info": "[SAKA VMDA-0001]\nSecond FDN."
      },
      {
        "id": "mpu_mpesa_bal",
        "label": "M-PESA Balance // SAKA Margins",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nAllowed margins:\n\u2022 1 \u2013 100: \u00b110\n\u2022 101 \u2013 1,000: \u00b150\n\u2022 1,001 \u2013 10,000: \u00b1100\n\u2022 > 10,001: \u00b110%"
      },
      {
        "id": "mpu_airtime_bal",
        "label": "Airtime Balance",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nCurrent airtime balance."
      },
      {
        "id": "mpu_self_txn1",
        "label": "Self-Txn 1 // Last 30d",
        "len": 0,
        "group": "self_txn",
        "info": "[SAKA VMDA-0001]\nSelf-initiated M-PESA transaction from customer account in last 30 days. Must provide Amount, Date/Time, and Recipient name. (2 txns count as 1 pass)."
      },
      {
        "id": "mpu_self_txn2",
        "label": "Self-Txn 2 // Last 30d",
        "len": 0,
        "group": "self_txn",
        "info": "[SAKA VMDA-0001]\nSecond self-initiated M-PESA transaction in last 30 days."
      },
      {
        "id": "mpu_limit",
        "label": "Loan Limit // Fuliza & M-Shwari",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nOpted-in FSI limit."
      },
      {
        "id": "mpu_regdate",
        "label": "Registration Date // Month & Year",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nMonth and Year of registration."
      },
      {
        "id": "mpu_g3_resumed",
        "label": "M-PESA G3 Resumed // Active",
        "len": 0,
        "info": "[SAKA VMDA-0001]\nAccount unsuspended on G3."
      }
    ],
    "comments": [
      "Vetted on primary and secondary details. Account unsuspended on G3. Advised customer.",
      "Account has active fraud tag from Risk Department. Advised customer to visit Safaricom HQ1 Waiyaki Way."
    ]
  },
  {
    "id": "general",
    "name": "General Enquiry / Account Query",
    "article": "IDPA-0001",
    "required": [
      {
        "id": "gen_callno",
        "label": "Calling Number",
        "len": 10,
        "info": "[SAKA IDPA-0001]\nMandatory calling number as per SAKA IDPA-0001."
      },
      {
        "id": "gen_msisdn",
        "label": "Customer Line Number",
        "len": 10,
        "info": "[SAKA IDPA-0001]\nThe subject MSISDN the customer is calling about."
      },
      {
        "id": "gen_query",
        "label": "Customer Query",
        "len": 0,
        "info": "[SAKA IDPA-0001]\nMain issue or enquiry (Tariff, Network, Bundles, Statement, Roaming, Billing, etc.)."
      },
      {
        "id": "gen_resolution",
        "label": "Resolution Given",
        "len": 0,
        "info": "[SAKA IDPA-0001]\nResolution, guidance, troubleshooting steps, or advice provided."
      }
    ],
    "optional": [
      {
        "id": "gen_name",
        "label": "Full Names // View 360",
        "len": 0,
        "info": "[SAKA IDPA-0001]\nIf inquiry touches account details, confirm registered names."
      },
      {
        "id": "gen_idnum",
        "label": "ID Number",
        "len": 8,
        "info": "[SAKA VMDA-0001]\nID document number if account data requested."
      },
      {
        "id": "gen_yob",
        "label": "Year of Birth",
        "len": 4,
        "info": "[SAKA VMDA-0001]\nYear of birth if primary vetting needed."
      },
      {
        "id": "gen_acct_check",
        "label": "Account Checked",
        "len": 0,
        "info": "[SAKA IDPA-0001]\nDetails of account check performed (Airtime, Data, M-PESA statement)."
      },
      {
        "id": "gen_on_behalf",
        "label": "Calling on Behalf",
        "len": 10,
        "info": "[SAKA IDPA-0001]\nIf customer is calling on behalf of another person, capture 3rd party line here."
      },
      {
        "id": "gen_repeat",
        "label": "Repeat Caller",
        "len": 0,
        "info": "[SAKA IDPA-0001]\nSelect \"Repeat Caller\" if customer called previously on same unresolved issue."
      },
      {
        "id": "gen_sr_ticket",
        "label": "SR Number",
        "len": 0,
        "info": "[SAKA IDPA-0001]\nCRM Service Request ticket number if escalated."
      },
      {
        "id": "gen_sla",
        "label": "SLA Given",
        "len": 0,
        "info": "[SAKA IDPA-0001]\nSLA communicated to customer (e.g. 2 hours, 24 hours, 72 hours)."
      }
    ],
    "comments": [
      "Customer inquired on account details. Vetted and provided requested information.",
      "Customer called regarding tariff and bundles. Guided on *544# options. Query resolved.",
      "Network issue reported. Troubleshooting conducted on line; escalated to Network Team via SR.",
      "Repeat caller on pending issue. Referenced previous interactions and escalated to team leader."
    ]
  }
];
}

let types = [];
let settings = { theme: 'auto', autoClear: 0 };
const curComments = () => {
  const t = curType();
  if (!t) return [];
  if (!Array.isArray(t.comments)) t.comments = [];
  return t.comments;
};
let activeTypeId = '';
let formValues = {};
let itemStatus = {};
let previewOpen = false;
let autoClearTimer = null;
let autoClearSeconds = 0;

const curType = () => types.find(t => t.id === activeTypeId) || types[0];
const curValues = () => (formValues[activeTypeId] || (formValues[activeTypeId] = {}));
const curStatus = () => (itemStatus[activeTypeId] || (itemStatus[activeTypeId] = {}));

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  settings.theme = theme;
  Storage.set('vpad.settings', settings);
}

const saveTypes = () => { Storage.setMultiple({ 'vpad.types': types, 'vpad.active': activeTypeId }); };
const saveSettings = () => { Storage.set('vpad.settings', settings); };
const saveComments = () => { saveTypes(); };

/* ==========================================================================
   Reusable CreatableSelect Component
   ========================================================================== */
class CreatableSelect {
  static n = 0;
  constructor(root, o = {}) {
    this.o = { options: [], value: null, placeholder: 'Select or type...', onChange: null, onCreate: null, ...o };
    this.opts = this.o.options.map(CreatableSelect.norm);
    this.val = this.o.value !== null ? String(this.o.value) : (this.opts[0] ? this.opts[0].value : null);
    this.q = ''; this.dirty = false; this.isOpen = false; this.idx = 0; this.items = [];
    this.id = 'cs' + (++CreatableSelect.n);
    this.root = root;
    this.renderSkeleton();
    this.sync();
  }

  static norm(x) {
    return typeof x === 'object' ? { value: String(x.value), label: String(x.label ?? x.value) } : { value: String(x), label: String(x) };
  }

  get selected() {
    return this.opts.find(o => o.value === this.val) || null;
  }

  setOptions(newOpts, newVal = null) {
    this.opts = newOpts.map(CreatableSelect.norm);
    if (newVal !== null) this.val = String(newVal);
    this.sync();
    this.render();
  }

  renderSkeleton() {
    this.root.innerHTML = `
      <div class="box">
        <input role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${this.id}-l" autocomplete="off" spellcheck="false" placeholder="${this.o.placeholder}">
        <span class="ctl">
          <button type="button" class="tog" tabindex="-1" aria-label="Toggle">
            <svg class="arrow" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
          </button>
        </span>
      </div>
      <ul id="${this.id}-l" role="listbox"></ul>
    `;
    this.input = this.root.querySelector('input');
    this.list = this.root.querySelector('ul');
    this.box = this.root.querySelector('.box');

    this.box.addEventListener('click', () => this.open());
    this.root.querySelector('.tog').addEventListener('click', (e) => {
      e.stopPropagation();
      this.isOpen ? this.close() : this.open();
    });

    this.list.addEventListener('mousedown', e => e.preventDefault());
    this.list.addEventListener('click', e => {
      const li = e.target.closest('li[data-i]');
      if (li) this.pick(this.items[+li.dataset.i]);
    });

    this.input.addEventListener('focus', () => {
      this.root.classList.add('focus');
      this.input.select();
      this.sync();
    });
    this.input.addEventListener('blur', () => {
      this.root.classList.remove('focus');
      this.close();
    });
    this.input.addEventListener('input', () => {
      this.dirty = true;
      this.q = this.input.value;
      this.idx = 0;
      this.open();
      this.render();
    });
    this.input.addEventListener('keydown', e => this.key(e));
  }

  sync() {
    if (!this.dirty) {
      this.input.value = this.selected ? this.selected.label : '';
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.input.setAttribute('aria-expanded', 'true');
    this.render();
    this.sync();
  }

  close() {
    if (!this.isOpen && !this.dirty) return;
    this.isOpen = false;
    this.dirty = false;
    this.q = '';
    this.root.classList.remove('open');
    this.input.setAttribute('aria-expanded', 'false');
    this.sync();
  }

  hl(label) {
    const q = this.q.trim();
    if (!q) return CreatableSelect.esc(label);
    const i = label.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return CreatableSelect.esc(label);
    return CreatableSelect.esc(label.slice(0, i)) + '<mark>' + CreatableSelect.esc(label.slice(i, i + q.length)) + '</mark>' + CreatableSelect.esc(label.slice(i + q.length));
  }

  static esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  render() {
    if (!this.isOpen) return;
    const q = this.q.trim().toLowerCase();
    this.items = this.opts.filter(o => !q || o.label.toLowerCase().includes(q)).map(o => ({ o }));
    const exact = this.opts.some(o => o.label.toLowerCase() === q);
    if (q && !exact) {
      this.items.push({ create: this.q.trim() });
    }

    this.idx = Math.min(this.idx, Math.max(this.items.length - 1, 0));
    const tick = '<svg class="tick" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

    this.list.innerHTML = this.items.length ? this.items.map((it, i) => it.create !== undefined
      ? `<li role="option" id="${this.id}-o${i}" data-i="${i}" class="create">+ Create “${CreatableSelect.esc(it.create)}”</li>`
      : `<li role="option" id="${this.id}-o${i}" data-i="${i}" aria-selected="${it.o.value === this.val}"><span>${this.hl(it.o.label)}</span>${tick}</li>`).join('')
      : '<li class="empty">No results</li>';

    this.paintActive(true);
  }

  paintActive(scroll) {
    this.list.querySelectorAll('li.active').forEach(l => l.classList.remove('active'));
    const el = this.list.querySelector(`li[data-i="${this.idx}"]`);
    if (el) {
      el.classList.add('active');
      this.input.setAttribute('aria-activedescendant', el.id);
      if (scroll) el.scrollIntoView({ block: 'nearest' });
    }
  }

  pick(it) {
    if (!it) return;
    let o = it.o;
    if (it.create !== undefined) {
      o = { value: uid(), label: it.create };
      this.opts.push(o);
      this.o.onCreate && this.o.onCreate(o);
    }
    this.val = o.value;
    this.close();
    this.sync();
    this.o.onChange && this.o.onChange(this.val, this);
  }

  key(e) {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      if (!this.isOpen) return this.open();
      const n = this.items.length;
      if (!n) return;
      this.idx = (this.idx + (k === 'ArrowDown' ? 1 : -1) + n) % n;
      this.paintActive(true);
    } else if (k === 'Enter') {
      if (this.isOpen) {
        e.preventDefault();
        this.pick(this.items[this.idx]);
      }
    } else if (k === 'Escape') {
      if (this.isOpen) {
        e.preventDefault();
        this.close();
      }
    }
  }
}

/* ==========================================================================
   Static Topbar Alert Banner with Shake Effect
   ========================================================================== */
const topBanner = document.getElementById('topBanner');
const topBannerMsg = document.getElementById('topBannerMsg');
const topBannerBtn = document.getElementById('topBannerBtn');
const topBannerClose = document.getElementById('topBannerClose');

let bannerTimer = null;

function showBanner(message, actionLabel = null, actionCallback = null, durationMs = 3500, type = 'info') {
  if (!topBanner) return;
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  topBanner.className = `top-banner banner-${type}`;
  topBannerMsg.textContent = message;

  if (actionLabel && actionCallback) {
    topBannerBtn.style.display = 'inline-block';
    topBannerBtn.textContent = actionLabel;
    topBannerBtn.onclick = (e) => {
      e.stopPropagation();
      actionCallback();
      hideBanner();
    };
  } else {
    topBannerBtn.style.display = 'none';
  }

  topBanner.style.display = 'flex';
  topBanner.style.animation = 'none';
  void topBanner.offsetWidth; // trigger reflow for shake animation
  topBanner.style.animation = 'bannerShake 0.4s ease-in-out';

  if (durationMs > 0) {
    bannerTimer = setTimeout(() => {
      hideBanner();
    }, durationMs);
  }
}

function hideBanner() {
  if (!topBanner) return;
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }
  topBanner.style.display = 'none';
}

if (topBannerClose) {
  topBannerClose.onclick = () => {
    if (autoClearTimer) {
      stopAutoClear();
    } else {
      hideBanner();
    }
  };
}

// Alias for backwards compatibility
const showToast = showBanner;

/* ==========================================================================
   Label Parser (Separates Clean Label from Reference Hint marked with //)
   ========================================================================== */
function parseLabel(raw) {
  const str = String(raw || '');
  const idx = str.indexOf('//');
  if (idx === -1) {
    return { main: str.trim(), hint: '', copy: str.trim() };
  }
  const main = str.slice(0, idx).trim();
  const hint = str.slice(idx + 2).trim();
  return { main, hint, copy: main || str.trim() };
}

/* ==========================================================================
   Build Text Output & Copy Operations
   ========================================================================== */
function buildCopyText(t) {
  const v = curValues();
  const st = curStatus();
  const lines = [];

  const c = (v._comment || '').trim();
  if (c) lines.push(c);

  const allItems = [...t.required, ...t.optional];
  const seenGroups = new Set();

  for (const it of allItems) {
    if (it.group) {
      if (seenGroups.has(it.group)) continue;
      seenGroups.add(it.group);

      const groupItems = allItems.filter(x => x.group === it.group);
      const parts = [];
      for (const git of groupItems) {
        const val = (v[git.id] || '').trim();
        if (val) {
          const { copy: copyLabel } = parseLabel(git.label);
          let str = `${copyLabel}: ${val}`;
          if (st[git.id] === 'passed') str += ' (Passed)';
          else if (st[git.id] === 'failed') str += ' (Failed)';
          parts.push(str);
        }
      }
      if (parts.length > 0) {
        lines.push(parts.join(', '));
      }
    } else {
      const val = (v[it.id] || '').trim();
      if (val) {
        const { copy: copyLabel } = parseLabel(it.label);
        let line = `${copyLabel}: ${val}`;
        if (st[it.id] === 'passed') line += ' (Passed)';
        else if (st[it.id] === 'failed') line += ' (Failed)';
        lines.push(line);
      }
    }
  }

  return lines.join('\n');
}

async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

/* ==========================================================================
   Auto-Clear Countdown on Clear Button
   ========================================================================== */
const btnClear = document.getElementById('btnClear');
const clearBtnText = document.getElementById('clearBtnText');

function stopAutoClear() {
  const wasActive = !!autoClearTimer;
  if (autoClearTimer) {
    clearInterval(autoClearTimer);
    autoClearTimer = null;
  }
  autoClearSeconds = 0;
  btnClear.classList.remove('countdown-active');
  clearBtnText.textContent = 'Clear';
  if (wasActive) {
    hideBanner();
  }
}

function startAutoClear(typeId) {
  stopAutoClear();
  if (!settings.autoClear || settings.autoClear <= 0) return;

  autoClearSeconds = settings.autoClear;
  btnClear.classList.add('countdown-active');
  clearBtnText.textContent = `Clear (${autoClearSeconds}s)`;

  // Display top banner with countdown and Cancel button (type 'warn', non-expiring until countdown or cancel)
  showBanner(`Clearing in ${autoClearSeconds}s...`, 'Cancel', () => {
    stopAutoClear();
  }, 0, 'warn');

  autoClearTimer = setInterval(() => {
    autoClearSeconds--;
    if (autoClearSeconds <= 0) {
      stopAutoClear();
      formValues[typeId] = {};
      itemStatus[typeId] = {};
      renderForm();
      updateCommentInput();
      syncPreview();
      showClearedFeedback();
    } else {
      clearBtnText.textContent = `Clear (${autoClearSeconds}s)`;
      if (topBannerMsg) {
        topBannerMsg.textContent = `Clearing in ${autoClearSeconds}s...`;
      }
    }
  }, 1000);
}

btnClear.onclick = () => {
  stopAutoClear();

  const v = curValues();
  const st = curStatus();
  if (!Object.values(v).some(x => x && x.trim()) && !Object.values(st).some(Boolean)) {
    return;
  }

  const snapVal = Object.assign({}, v);
  const snapStatus = Object.assign({}, st);

  formValues[activeTypeId] = {};
  itemStatus[activeTypeId] = {};
  renderForm();
  updateCommentInput();
  syncPreview();

  showClearedFeedback();

  showBanner('Details cleared', 'Undo', () => {
    formValues[activeTypeId] = snapVal;
    itemStatus[activeTypeId] = snapStatus;
    renderForm();
    updateCommentInput();
    syncPreview();
  }, 4000, 'info');
};

function showClearedFeedback() {
  const originalHtml = btnClear.innerHTML;
  btnClear.classList.add('cleared-success');
  btnClear.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 5 5L20 7"/></svg>
    <span>Cleared</span>
  `;
  setTimeout(() => {
    btnClear.classList.remove('cleared-success');
    btnClear.innerHTML = originalHtml;
  }, 1200);
}

/* ==========================================================================
   Main Form Rendering (Masked Underline Slots)
   ========================================================================== */
const mainForm = document.getElementById('mainForm');

let popoverTimeout = null;

function closeInfoPopover() {
  const pop = document.getElementById('activeSakaPopover');
  if (pop) pop.remove();
  document.querySelectorAll('.mat-info-btn.active').forEach(b => b.classList.remove('active'));
}

function showInfoPopover(btn, text, label) {
  closeInfoPopover();
  if (!text) return;
  btn.classList.add('active');

  const { main: cleanTitle } = parseLabel(label);
  const pop = document.createElement('div');
  pop.className = 'saka-popover';
  pop.id = 'activeSakaPopover';
  pop.dataset.ownerBtn = btn.dataset.infoId;

  // Extract [SAKA XXXX] tag if present
  let articleTag = '';
  let cleanText = text;
  const artMatch = text.match(/^\[SAKA\s+([^\]]+)\]\s*\n?/);
  if (artMatch) {
    articleTag = artMatch[1];
    cleanText = text.slice(artMatch[0].length);
  } else {
    const t = curType();
    if (t && t.article) articleTag = t.article;
  }

  const lines = cleanText.split('\n');
  const bodyHtml = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('•') || trimmed.startsWith('-')) {
      return `<div class="pop-bullet"><span class="pop-dot">•</span><span>${escapeHtml(trimmed.replace(/^[•-]\s*/, ''))}</span></div>`;
    }
    return `<div class="pop-line">${escapeHtml(trimmed)}</div>`;
  }).join('');

  const articleBadge = articleTag ? `<span class="pop-article">${escapeHtml(articleTag)}</span>` : '';

  pop.innerHTML = `
    <div class="pop-header">
      <div class="pop-title-wrap">
        <span class="pop-title">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          ${escapeHtml(cleanTitle)}
        </span>
        ${articleBadge}
      </div>
      <button type="button" class="pop-close" aria-label="Close popover">✕</button>
    </div>
    <div class="pop-content">${bodyHtml}</div>
  `;

  document.body.appendChild(pop);

  const btnRect = btn.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();

  let left = Math.min(Math.max(10, btnRect.left - 20), window.innerWidth - popRect.width - 10);
  let top = btnRect.bottom + 4;

  if (top + popRect.height > window.innerHeight - 8) {
    top = Math.max(8, btnRect.top - popRect.height - 4);
  }

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  pop.querySelector('.pop-close').onclick = (e) => {
    e.stopPropagation();
    closeInfoPopover();
  };

  pop.addEventListener('mouseenter', () => clearTimeout(popoverTimeout));
  pop.addEventListener('mouseleave', () => {
    popoverTimeout = setTimeout(closeInfoPopover, 300);
  });
}

function setupInfoPopovers() {
  mainForm.querySelectorAll('.mat-info-btn').forEach(btn => {
    const itemId = btn.dataset.infoId;
    const t = curType();
    if (!t) return;
    const it = [...t.required, ...t.optional].find(x => x.id === itemId);
    if (!it || !it.info) return;

    btn.addEventListener('mouseenter', () => {
      clearTimeout(popoverTimeout);
      showInfoPopover(btn, it.info, it.label);
    });

    btn.addEventListener('mouseleave', () => {
      popoverTimeout = setTimeout(() => {
        const pop = document.getElementById('activeSakaPopover');
        if (pop && !pop.matches(':hover')) {
          closeInfoPopover();
        }
      }, 300);
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pop = document.getElementById('activeSakaPopover');
      if (pop && pop.dataset.ownerBtn === itemId) {
        closeInfoPopover();
      } else {
        showInfoPopover(btn, it.info, it.label);
      }
    });
  });
}

function getGroupStatus(grpItems, st) {
  if (!grpItems || grpItems.length === 0) return null;
  const statuses = grpItems.map(it => st[it.id] || '');
  if (statuses.some(s => s === 'failed')) return 'failed';
  if (statuses.every(s => s === 'passed')) return 'passed';
  if (statuses.some(s => s === 'passed')) return 'partial';
  return null;
}

function updateTiedGroupBrackets() {
  const t = curType();
  if (!t) return;
  const st = curStatus();
  const allItems = [...t.required, ...t.optional];

  mainForm.querySelectorAll('.tied-group-wrap').forEach(wrap => {
    const grpId = wrap.dataset.group;
    if (!grpId) return;
    const grpItems = allItems.filter(x => x.group === grpId);
    const grpStatus = getGroupStatus(grpItems, st);

    wrap.classList.remove('status-passed', 'status-partial', 'status-failed');
    if (grpStatus) {
      wrap.classList.add(`status-${grpStatus}`);
    }
  });
}

function updateSecondaryCounter() {
  const t = curType();
  const pill = document.getElementById('secCounterPill');
  if (!t || !pill) return;

  const minSec = t.minSecondary || 0;
  if (!minSec) {
    pill.style.display = 'none';
    return;
  }
  pill.style.display = 'inline-flex';

  const st = curStatus();
  let passedCount = 0;
  let failedCount = 0;

  const processedGroups = new Set();
  t.optional.forEach(it => {
    if (it.group) {
      if (processedGroups.has(it.group)) return;
      processedGroups.add(it.group);
      const grpItems = t.optional.filter(x => x.group === it.group);
      const grpStatus = getGroupStatus(grpItems, st);
      if (grpStatus === 'passed') passedCount++;
      else if (grpStatus === 'failed') failedCount++;
    } else {
      if (st[it.id] === 'passed') passedCount++;
      if (st[it.id] === 'failed') failedCount++;
    }
  });

  pill.textContent = `${passedCount}/${minSec}${passedCount >= minSec ? ' ✓' : ''}`;
  pill.classList.toggle('met', passedCount >= minSec);
  pill.classList.toggle('partial', passedCount > 0 && passedCount < minSec);

  if (failedCount >= 5 && !pill.dataset.alerted5) {
    pill.dataset.alerted5 = 'true';
    showBanner('5 secondary questions failed (SAKA VMDA-0001). Record details and advise customer to call back or visit Retail.', null, null, 6000, 'warn');
  } else if (failedCount < 5) {
    delete pill.dataset.alerted5;
  }
}

function renderItemList(items, kind, st) {
  let html = '';
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.group) {
      const grpId = it.group;
      const grpItems = [];
      let j = i;
      while (j < items.length && items[j].group === grpId) {
        grpItems.push(items[j]);
        j++;
      }
      const grpStatus = getGroupStatus(grpItems, st);
      const statusClass = grpStatus ? ` status-${grpStatus}` : '';
      html += `<div class="tied-group-wrap${statusClass}" data-group="${escapeHtml(grpId)}">`;
      html += `<div class="tied-bracket" title="Tied group: counts as 1 secondary point"></div>`;
      html += `<div class="tied-items-col">`;
      grpItems.forEach((gIt, gIdx) => {
        html += createRowHtml(gIt, kind, i + gIdx);
      });
      html += `</div>`;
      html += `</div>`;
      i = j;
    } else {
      html += createRowHtml(it, kind, i);
      i++;
    }
  }
  return html;
}

function renderForm() {
  const t = curType();
  if (!t) return;
  const st = curStatus();

  let html = '';

  html += renderItemList(t.required, 'mandatory', st);

  if (t.optional.length > 0) {
    const minSec = t.minSecondary || 0;
    const dividerTitle = 'Secondary';
    const pillHtml = minSec > 0 ? `<span class="sec-counter-pill" id="secCounterPill">0/${minSec}</span>` : '';
    html += `
      <div class="subtle-divider">
        <span class="subtle-divider-title">${dividerTitle}</span>
        ${pillHtml}
      </div>
    `;
    html += renderItemList(t.optional, 'optional', st);
  }

  mainForm.innerHTML = html;
  bindFormEvents();
  syncAllGuides();
  updateTiedGroupBrackets();
  updateSecondaryCounter();
  setupInfoPopovers();
  syncPreview();
}

function createRowHtml(it, kind, idx) {
  const val = curValues()[it.id] || '';
  const isFilled = val.length > 0;
  const isMandatory = kind === 'mandatory';
  const st = curStatus()[it.id] || '';
  const isExpanded = isFilled || !!st;

  let underlineHtml = '';
  if (it.len > 0) {
    let slots = '';
    for (let i = 0; i < it.len; i++) {
      slots += `<span class="slot" data-slot-idx="${i}"></span>`;
    }
    underlineHtml = `
      <div class="mat-underline-wrap">
        <div class="mat-underline-track ${st ? 'status-' + st : ''}" id="track_${it.id}">${slots}</div>
        <div class="mat-underline-rest"></div>
      </div>
    `;
  } else {
    underlineHtml = `<div class="mat-underline-continuous"></div>`;
  }

  const { main: lblMain, hint: lblHint } = parseLabel(it.label);
  const lblDisplay = lblHint
    ? `<span class="mat-label-main">${escapeHtml(lblMain)}</span> <span class="mat-label-hint">(${escapeHtml(lblHint)})</span>`
    : `<span class="mat-label-main">${escapeHtml(lblMain)}</span>`;
  const lblTitle = lblHint ? `${lblMain} (${lblHint})` : lblMain;

  const infoBtnHtml = it.info ? `
    <button type="button" class="mat-info-btn" data-info-id="${it.id}" title="SAKA Guideline" aria-label="View SAKA guidelines for ${escapeHtml(lblMain)}">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
    </button>
  ` : '';

  return `
    <div class="item-row ${kind}" data-id="${it.id}">
      <div class="field-container">
        <div class="material-field ${isExpanded ? 'expanded' : ''} ${isFilled ? 'has-value' : ''} ${st ? 'status-' + st : ''}">
          <label class="mat-label" for="inp_${it.id}" title="${escapeHtml(lblTitle)}">
            <span class="mat-label-text">${lblDisplay}${isMandatory ? ' <span class="req-mark" title="Required">*</span>' : ''}</span>
            ${infoBtnHtml}
          </label>
          ${it.len > 0 ? `<span class="field-counter" id="cnt_${it.id}"></span>` : ''}
          <input type="text" class="mat-input ${it.len > 0 ? 'has-len' : ''}" id="inp_${it.id}" data-id="${it.id}" value="${escapeHtml(val)}" autocomplete="off" spellcheck="false">
          ${underlineHtml}
        </div>
      </div>

      <!-- Pass / Fail Action Icons: Ban ⊘ and Check ✓ -->
      <div class="status-actions">
        <button type="button" class="pf-btn fail ${st === 'failed' ? 'active' : ''}" data-status-btn="failed" data-id="${it.id}" title="Mark as Failed" aria-label="Mark ${escapeHtml(lblMain)} as Failed">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        </button>
        <button type="button" class="pf-btn pass ${st === 'passed' ? 'active' : ''}" data-status-btn="passed" data-id="${it.id}" title="Mark as Passed" aria-label="Mark ${escapeHtml(lblMain)} as Passed">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 12 5 5L20 7"/>
          </svg>
        </button>
      </div>

      <button type="button" class="paste-btn" data-paste-id="${it.id}" title="Paste from clipboard" aria-label="Paste ${escapeHtml(lblMain)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
      </button>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function syncAllGuides() {
  const t = curType();
  if (!t) return;
  const allItems = [...t.required, ...t.optional];
  allItems.forEach(it => updateRowGuide(it.id));
}

function updateRowGuide(itemId) {
  const t = curType();
  if (!t) return;
  const it = [...t.required, ...t.optional].find(x => x.id === itemId);
  if (!it) return;

  const row = mainForm.querySelector(`.item-row[data-id="${itemId}"]`);
  if (!row) return;

  const input = row.querySelector('.mat-input');
  const fieldBox = row.querySelector('.material-field');
  const track = row.querySelector(`#track_${itemId}`);
  const counter = row.querySelector(`#cnt_${itemId}`);

  const val = input.value;
  const n = val.length;
  const isFocused = document.activeElement === input;
  const hasStatus = !!curStatus()[itemId];

  fieldBox.classList.toggle('has-value', n > 0);
  fieldBox.classList.toggle('expanded', n > 0 || isFocused || hasStatus);

  if (track && it.len > 0) {
    const slots = track.querySelectorAll('.slot');
    slots.forEach((slot, idx) => {
      slot.classList.toggle('filled', idx < n);
      // Only highlight cursor slot if focused and not full, NEVER when empty and blurred!
      slot.classList.toggle('current', isFocused && idx === n && n < it.len);
    });

    if (counter) {
      if (n > 0) {
        counter.classList.add('visible');
        counter.textContent = `${n}/${it.len}${n === it.len ? ' ✓' : ''}`;
        counter.classList.toggle('match', n === it.len);
        counter.classList.toggle('overflow', n > it.len);
      } else {
        counter.classList.remove('visible');
        counter.textContent = '';
      }
    }
  }
}

/* ==========================================================================
   Events & Status Pass / Fail
   ========================================================================== */
function bindFormEvents() {
  mainForm.querySelectorAll('.mat-input').forEach(input => {
    const box = input.closest('.material-field');
    const id = input.dataset.id;

    input.addEventListener('focus', () => {
      box.classList.add('is-focused', 'expanded');
      updateRowGuide(id);
    });

    input.addEventListener('blur', () => {
      box.classList.remove('is-focused');
      const val = input.value;
      const hasStatus = !!curStatus()[id];
      if (val.length === 0 && !hasStatus) {
        box.classList.remove('expanded');
      }
      updateRowGuide(id);
    });

    input.addEventListener('input', () => {
      stopAutoClear();
      curValues()[id] = input.value;
      updateRowGuide(id);
      syncPreview();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const inputs = [...mainForm.querySelectorAll('.mat-input')];
        const nextIdx = inputs.indexOf(input) + 1;
        if (nextIdx < inputs.length) {
          inputs[nextIdx].focus();
        } else {
          document.getElementById('commentInput').focus();
        }
      }
    });
  });

  mainForm.querySelectorAll('[data-status-btn]').forEach(btn => {
    btn.onclick = () => {
      stopAutoClear();
      const id = btn.dataset.id;
      const targetStatus = btn.dataset.statusBtn;
      const cur = curStatus()[id];

      const newStatus = cur === targetStatus ? null : targetStatus;
      curStatus()[id] = newStatus;

      const row = btn.closest('.item-row');
      const box = row.querySelector('.material-field');
      const track = row.querySelector('.mat-underline-track');
      const input = row.querySelector('.mat-input');

      box.classList.remove('status-passed', 'status-failed');
      if (track) track.classList.remove('status-passed', 'status-failed');

      if (newStatus) {
        box.classList.add(`status-${newStatus}`, 'expanded');
        if (track) track.classList.add(`status-${newStatus}`);
      } else {
        if (input && input.value.trim().length === 0 && document.activeElement !== input) {
          box.classList.remove('expanded');
        }
      }

      row.querySelectorAll('.pf-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.statusBtn === newStatus);
      });

      updateTiedGroupBrackets();
      syncPreview();
      updateSecondaryCounter();
    };
  });

  mainForm.querySelectorAll('.paste-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.pasteId;
      const input = mainForm.querySelector(`.mat-input[data-id="${id}"]`);
      if (!input) return;
      try {
        const text = (await navigator.clipboard.readText()).replace(/\s*[\r\n]+\s*/g, ' ').trim();
        input.value = text;
        curValues()[id] = text;
        stopAutoClear();
        const box = input.closest('.material-field');
        if (box) box.classList.add('expanded');
        updateRowGuide(id);
        syncPreview();
        input.focus();

        input.style.transition = 'background 0.2s ease';
        input.style.background = 'var(--saf-emerald-soft)';
        setTimeout(() => { input.style.background = 'transparent'; }, 400);
      } catch (err) {
        showToast('Clipboard access denied', null, null, 2500, 'warn');
        input.focus();
      }
    };
  });
}

/* ==========================================================================
   Comment Handling & Suggestions Dropdown with Instant Deletion
   ========================================================================== */
const commentInput = document.getElementById('commentInput');
const commentFieldBox = document.getElementById('commentFieldBox');
const commentSuggestionsMenu = document.getElementById('commentSuggestionsMenu');

let activeSuggestionIdx = -1;
let currentFilteredSuggestions = [];

function highlightCommentMatch(text, query) {
  if (!query) return escapeHtml(text);
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return escapeHtml(text);
  const before = escapeHtml(text.slice(0, idx));
  const match = escapeHtml(text.slice(idx, idx + query.length));
  const after = escapeHtml(text.slice(idx + query.length));
  return `${before}<mark style="background:none;color:var(--saf-emerald);font-weight:700;">${match}</mark>${after}`;
}

function renderCommentSuggestions(filterQuery = '') {
  if (!commentSuggestionsMenu) return;
  const q = filterQuery.trim().toLowerCase();
  const typeComments = curComments();
  currentFilteredSuggestions = q
    ? typeComments.filter(c => c.toLowerCase().includes(q))
    : [...typeComments];

  if (currentFilteredSuggestions.length === 0) {
    closeCommentSuggestions();
    return;
  }

  activeSuggestionIdx = -1;
  commentSuggestionsMenu.innerHTML = currentFilteredSuggestions.map((c, idx) => `
    <li role="option" data-idx="${idx}" data-val="${escapeHtml(c)}">
      <span class="cs-text" title="${escapeHtml(c)}">${highlightCommentMatch(c, filterQuery.trim())}</span>
      <button type="button" class="cs-del" data-del-comment="${escapeHtml(c)}" title="Remove this suggestion" aria-label="Delete ${escapeHtml(c)}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </li>
  `).join('');

  commentSuggestionsMenu.classList.add('open');
}

function closeCommentSuggestions() {
  if (!commentSuggestionsMenu) return;
  commentSuggestionsMenu.classList.remove('open');
  commentSuggestionsMenu.innerHTML = '';
  activeSuggestionIdx = -1;
  currentFilteredSuggestions = [];
}

// Handle clicks inside suggestion menu (selection vs delete)
if (commentSuggestionsMenu) {
  // Use pointerdown to intercept before commentInput blur
  commentSuggestionsMenu.addEventListener('pointerdown', (e) => {
    const delBtn = e.target.closest('.cs-del');
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      const commentToDelete = delBtn.dataset.delComment;
      const t = curType();
      if (t && Array.isArray(t.comments)) {
        const idx = t.comments.indexOf(commentToDelete);
        if (idx !== -1) {
          t.comments.splice(idx, 1);
          saveTypes();
          renderCommentSuggestions(commentInput.value);
          showToast('Comment deleted', null, null, 1500, 'info');
        }
      }
      return;
    }

    const li = e.target.closest('li[data-val]');
    if (li) {
      e.preventDefault();
      stopAutoClear();
      const val = li.dataset.val;
      commentInput.value = val;
      curValues()._comment = val;
      const hasVal = val.length > 0;
      commentFieldBox.classList.toggle('has-value', hasVal);
      commentFieldBox.classList.toggle('expanded', hasVal);
      closeCommentSuggestions();
      syncPreview();
      commentInput.focus();
    }
  });
}

// Close suggestion menu if clicking outside
document.addEventListener('pointerdown', (e) => {
  if (commentSuggestionsMenu && commentSuggestionsMenu.classList.contains('open')) {
    if (!commentFieldBox.contains(e.target) && !commentSuggestionsMenu.contains(e.target)) {
      closeCommentSuggestions();
    }
  }
});

commentInput.addEventListener('focus', () => {
  commentFieldBox.classList.add('is-focused', 'expanded');
  renderCommentSuggestions(commentInput.value);
});

commentInput.addEventListener('blur', () => {
  commentFieldBox.classList.remove('is-focused');
  if (commentInput.value.trim().length === 0) {
    commentFieldBox.classList.remove('expanded');
  }
  // Delay close to allow pointer events on menu to resolve
  setTimeout(() => {
    if (!commentSuggestionsMenu.matches(':hover')) {
      closeCommentSuggestions();
    }
  }, 120);
});

commentInput.addEventListener('input', () => {
  stopAutoClear();
  curValues()._comment = commentInput.value;
  const hasVal = commentInput.value.length > 0;
  commentFieldBox.classList.toggle('has-value', hasVal);
  commentFieldBox.classList.toggle('expanded', hasVal || document.activeElement === commentInput);
  renderCommentSuggestions(commentInput.value);
  syncPreview();
});

commentInput.addEventListener('keydown', (e) => {
  if (commentSuggestionsMenu && commentSuggestionsMenu.classList.contains('open') && currentFilteredSuggestions.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeSuggestionIdx = (activeSuggestionIdx + 1) % currentFilteredSuggestions.length;
      updateSuggestionHighlight();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeSuggestionIdx = (activeSuggestionIdx - 1 + currentFilteredSuggestions.length) % currentFilteredSuggestions.length;
      updateSuggestionHighlight();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommentSuggestions();
      return;
    }
    if (e.key === 'Enter') {
      if (activeSuggestionIdx >= 0 && activeSuggestionIdx < currentFilteredSuggestions.length) {
        e.preventDefault();
        stopAutoClear();
        const selectedVal = currentFilteredSuggestions[activeSuggestionIdx];
        commentInput.value = selectedVal;
        curValues()._comment = selectedVal;
        const hasVal = selectedVal.length > 0;
        commentFieldBox.classList.toggle('has-value', hasVal);
        commentFieldBox.classList.toggle('expanded', hasVal);
        closeCommentSuggestions();
        syncPreview();
        return;
      }
    }
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    closeCommentSuggestions();
    doCopy();
  }
});

function updateSuggestionHighlight() {
  if (!commentSuggestionsMenu) return;
  const items = commentSuggestionsMenu.querySelectorAll('li[data-idx]');
  items.forEach((item, idx) => {
    if (idx === activeSuggestionIdx) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

function updateCommentInput() {
  const v = curValues()._comment || '';
  commentInput.value = v;
  const hasVal = v.length > 0;
  commentFieldBox.classList.toggle('has-value', hasVal);
  commentFieldBox.classList.toggle('expanded', hasVal || document.activeElement === commentInput);
  closeCommentSuggestions();
}

/* ==========================================================================
   Preview & Actions
   ========================================================================== */
const previewDrawer = document.getElementById('previewDrawer');
const previewText = document.getElementById('previewText');
const btnTogglePreview = document.getElementById('btnTogglePreview');

btnTogglePreview.onclick = () => {
  previewOpen = !previewOpen;
  btnTogglePreview.classList.toggle('active', previewOpen);
  previewDrawer.classList.toggle('open', previewOpen);
  syncPreview();
};

function syncPreview() {
  const txt = buildCopyText(curType());
  if (txt) {
    previewText.textContent = txt;
    previewText.classList.remove('empty');
  } else {
    previewText.textContent = 'Nothing filled in yet';
    previewText.classList.add('empty');
  }
}

const btnCopy = document.getElementById('btnCopy');
const copyBtnText = document.getElementById('copyBtnText');

async function doCopy() {
  const t = curType();
  const text = buildCopyText(t);
  if (!text) {
    showToast('Nothing to copy. Fill in some details first.', null, null, 2500, 'warn');
    return;
  }

  const ok = await writeToClipboard(text);
  if (!ok) {
    showToast('Copy failed. Clipboard error.', null, null, 2500, 'danger');
    return;
  }

  const c = (curValues()._comment || '').trim();
  if (c && t) {
    if (!Array.isArray(t.comments)) t.comments = [];
    if (!t.comments.includes(c)) {
      t.comments.unshift(c);
      if (t.comments.length > 20) t.comments.pop();
      saveTypes();
      updateCommentInput();
    }
  }

  btnCopy.classList.add('copied-success');
  copyBtnText.textContent = 'Copied ✓';
  setTimeout(() => {
    btnCopy.classList.remove('copied-success');
    copyBtnText.textContent = 'Copy';
  }, 1400);

  startAutoClear(t.id);
}
btnCopy.onclick = doCopy;

/* ==========================================================================
   Mount CreatableSelect for Vetting Types
   ========================================================================== */
const typeSelectMount = document.getElementById('typeSelectMount');
let typeSelectComponent = null;

function initTypeSelect() {
  typeSelectComponent = new CreatableSelect(typeSelectMount, {
    options: types.map(t => ({ value: t.id, label: t.name })),
    value: activeTypeId,
    placeholder: 'Vetting type...',
    onChange: (val) => {
      activeTypeId = val;
      saveTypes();
      stopAutoClear();
      renderForm();
      updateCommentInput();
    },
    onCreate: (opt) => {
      const newTypeObj = {
        id: opt.value,
        name: opt.label,
        required: [
          { id: uid(), label: 'Full Name', len: 0 },
          { id: uid(), label: 'ID Number', len: 8 },
          { id: uid(), label: 'Line Number', len: 10 }
        ],
        optional: []
      };
      types.push(newTypeObj);
      activeTypeId = newTypeObj.id;
      saveTypes();
      renderForm();
      updateCommentInput();
      openEditView();
    }
  });
}

function refreshTypeSelect() {
  if (typeSelectComponent) {
    typeSelectComponent.setOptions(types.map(t => ({ value: t.id, label: t.name })), activeTypeId);
  }
}

/* ==========================================================================
   Edit Vetting Items Screen
   ========================================================================== */
const editView = document.getElementById('editView');
const btnEditType = document.getElementById('btnEditType');
const btnBackEdit = document.getElementById('btnBackEdit');
const editPane = document.getElementById('editPane');

btnEditType.onclick = () => openEditView();
btnBackEdit.onclick = () => closeEditView();

function openEditView() {
  editView.style.display = 'flex';
  renderEditView();
}
function closeEditView() {
  editView.style.display = 'none';
  saveTypes();
  refreshTypeSelect();
  renderForm();
}

function renderEditView() {
  const t = curType();
  let html = `
    <div class="section-head" style="margin-top:0;">Vetting Type Name</div>
    <div class="material-field has-value" style="margin-bottom:8px;">
      <input type="text" class="mat-input" id="editTypeName" value="${escapeHtml(t.name)}" placeholder="e.g. SIM Swap">
      <div class="mat-underline-continuous" style="height:2px;background:var(--saf-emerald)"></div>
    </div>

    <div class="edit-type-meta-row">
      <span class="meta-label">Min Secondary Passes:</span>
      <input type="number" id="editMinSecondary" min="0" max="10" value="${t.minSecondary || 0}" class="el-min-sec" title="Minimum secondary questions required to pass (e.g. 2 for Enhanced Vetting)">
    </div>

    <div class="section-head">
      <span>Primary Items</span>
      <span style="font-size:9.5px;color:var(--text-dim);">Fixed Order</span>
    </div>
    <div id="editReqList">
      ${t.required.map((it, i) => createEditRowHtml(it, 'required', i, t.required.length, t.required)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:5px;" id="btnAddReq">+ Add Primary Item</button>

    <div class="section-head" style="margin-top:14px;">
      <span>Secondary Items</span>
      <span style="font-size:9.5px;color:var(--text-dim);">Use ▲▼ or Alt+↑/↓ to Reorder</span>
    </div>
    <div id="editOptList">
      ${t.optional.map((it, i) => createEditRowHtml(it, 'optional', i, t.optional.length, t.optional)).join('')}
    </div>
    <button class="btn-action" style="width:100%;margin-top:5px;" id="btnAddOpt">+ Add Secondary Item</button>

    <button class="btn-action" id="btnDeleteType" style="width:100%;margin-top:20px;color:var(--color-danger);border-color:var(--border-line);">
      Delete this Vetting Type
    </button>
  `;

  editPane.innerHTML = html;
  bindEditEvents();
}

function createEditRowHtml(it, kind, idx, total, list) {
  const hasRich = !!(it.article || it.info);
  const isTied = !!it.group;
  let canMoveUp = idx > 0;
  let canMoveDown = idx < total - 1;

  if (isTied && list) {
    let startIdx = idx;
    while (startIdx > 0 && list[startIdx - 1].group === it.group) startIdx--;
    let endIdx = idx;
    while (endIdx < list.length - 1 && list[endIdx + 1].group === it.group) endIdx++;
    canMoveUp = startIdx > 0;
    canMoveDown = endIdx < list.length - 1;
  }

  return `
    <div class="edit-item-group ${isTied ? 'is-tied' : ''}" data-id="${it.id}" data-kind="${kind}">
      <div class="edit-row">
        <div class="arrows-col">
          <button type="button" class="arr-btn" data-move="-1" title="Move Up (Alt+↑)" aria-label="Move Up" ${canMoveUp ? '' : 'disabled'}>▲</button>
          <button type="button" class="arr-btn" data-move="1" title="Move Down (Alt+↓)" aria-label="Move Down" ${canMoveDown ? '' : 'disabled'}>▼</button>
        </div>
        <input type="text" class="el-label" value="${escapeHtml(it.label)}" placeholder="Label // hint" title="Label name (use // for uncopied hint, e.g. Name // If 3rd Party)">
        <input type="number" class="el-len" value="${it.len || ''}" placeholder="len" title="Guide length in characters">
        <button type="button" class="ibtn btn-toggle-drawer ${hasRich ? 'has-rich' : ''}" data-drawer-btn="${it.id}" title="Edit SAKA Article & Guidelines" aria-label="Edit SAKA info">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
        <button type="button" class="ibtn btn-tie-pair ${isTied ? 'is-tied' : ''}" data-tie-id="${it.id}" title="${isTied ? 'Tied pair (counts as 1 pass). Click to unlink.' : 'Click to tie with adjacent item as 1 pass count'}" aria-label="Tie pair">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </button>
        <button type="button" class="ibtn" data-del="true" title="Remove item" style="width:20px;height:20px;color:var(--color-danger);">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="edit-item-drawer" id="drawer_${it.id}" style="display:none;">
        <div class="drawer-field">
          <span class="drawer-label">SAKA Article:</span>
          <input type="text" class="el-article" value="${escapeHtml(it.article || '')}" placeholder="e.g. VMDA-0001">
        </div>
        <div class="drawer-field">
          <span class="drawer-label">Guidelines / Popover Info:</span>
          <textarea class="el-info" rows="2" placeholder="SAKA instruction or verification rule">${escapeHtml(it.info || '')}</textarea>
        </div>
      </div>
    </div>
  `;
}

function moveItemInList(list, idx, step) {
  if (idx < 0 || idx >= list.length || !step) return false;
  const it = list[idx];
  if (it.group) {
    let startIdx = idx;
    while (startIdx > 0 && list[startIdx - 1].group === it.group) startIdx--;
    let endIdx = idx;
    while (endIdx < list.length - 1 && list[endIdx + 1].group === it.group) endIdx++;

    if (step < 0) {
      if (startIdx <= 0) return false;
      const prevItem = list.splice(startIdx - 1, 1)[0];
      list.splice(endIdx, 0, prevItem);
      return true;
    } else if (step > 0) {
      if (endIdx >= list.length - 1) return false;
      const nextItem = list.splice(endIdx + 1, 1)[0];
      list.splice(startIdx, 0, nextItem);
      return true;
    }
  } else {
    const targetIdx = idx + step;
    if (targetIdx >= 0 && targetIdx < list.length) {
      [list[idx], list[targetIdx]] = [list[targetIdx], list[idx]];
      return true;
    }
  }
  return false;
}

function bindEditEvents() {
  const t = curType();
  const nameInput = document.getElementById('editTypeName');
  if (nameInput) {
    nameInput.oninput = () => {
      t.name = nameInput.value || 'Untitled';
      saveTypes();
      refreshTypeSelect();
    };
  }

  const minSecInput = document.getElementById('editMinSecondary');
  if (minSecInput) {
    minSecInput.oninput = () => {
      t.minSecondary = Math.max(0, parseInt(minSecInput.value, 10) || 0);
      saveTypes();
    };
  }

  editPane.onclick = (e) => {
    const drawerBtn = e.target.closest('[data-drawer-btn]');
    if (drawerBtn) {
      const id = drawerBtn.dataset.drawerBtn;
      const drawer = document.getElementById(`drawer_${id}`);
      if (drawer) {
        const isHidden = drawer.style.display === 'none' || !drawer.style.display;
        drawer.style.display = isHidden ? 'block' : 'none';
        drawerBtn.classList.toggle('active', isHidden);
      }
      return;
    }

    const group = e.target.closest('.edit-item-group');
    if (!group) {
      if (e.target.id === 'btnAddReq') {
        t.required.push({ id: uid(), label: 'New Required', len: 0 });
        renderEditView();
      } else if (e.target.id === 'btnAddOpt') {
        t.optional.push({ id: uid(), label: 'New Optional', len: 0 });
        renderEditView();
      } else if (e.target.id === 'btnDeleteType') {
        if (types.length <= 1) {
          showToast('Cannot delete the last vetting type', null, null, 2500, 'warn');
          return;
        }
        if (confirm(`Delete "${t.name}"?`)) {
          types = types.filter(x => x.id !== t.id);
          delete formValues[t.id];
          delete itemStatus[t.id];
          activeTypeId = types[0].id;
          saveTypes();
          refreshTypeSelect();
          closeEditView();
        }
      }
      return;
    }

    const kind = group.dataset.kind;
    const list = kind === 'required' ? t.required : t.optional;
    const itemId = group.dataset.id;
    const idx = list.findIndex(x => x.id === itemId);

    const tieBtn = e.target.closest('[data-tie-id]');
    if (tieBtn) {
      const it = list[idx];
      if (!it) return;
      if (it.group) {
        const grpId = it.group;
        list.forEach(x => {
          if (x.group === grpId) delete x.group;
        });
      } else {
        let partner = null;
        if (idx < list.length - 1) {
          partner = list[idx + 1];
        } else if (idx > 0) {
          partner = list[idx - 1];
        }
        if (partner) {
          const newGrp = 'grp_' + uid();
          it.group = newGrp;
          partner.group = newGrp;
        }
      }
      saveTypes();
      renderEditView();
      return;
    }

    if (e.target.closest('[data-del]')) {
      const it = list[idx];
      list.splice(idx, 1);
      if (it && it.group) {
        const remaining = list.filter(x => x.group === it.group);
        if (remaining.length <= 1) {
          remaining.forEach(r => delete r.group);
        }
      }
      saveTypes();
      renderEditView();
      return;
    } else if (e.target.closest('[data-move]')) {
      const step = parseInt(e.target.closest('[data-move]').dataset.move, 10);
      if (moveItemInList(list, idx, step)) {
        saveTypes();
        renderEditView();
        const newGroup = editPane.querySelector(`.edit-item-group[data-id="${itemId}"]`);
        if (newGroup) {
          const btn = newGroup.querySelector(`[data-move="${step}"]`) || newGroup.querySelector('.arr-btn');
          if (btn && !btn.disabled) btn.focus();
        }
      }
      return;
    }
  };

  // Keyboard reordering: Alt+↑ / Alt+↓ anywhere on row, plain ↑ / ↓ on arr-btn
  editPane.onkeydown = (e) => {
    const group = e.target.closest('.edit-item-group');
    if (!group) return;

    const isAltUp = e.altKey && e.key === 'ArrowUp';
    const isAltDown = e.altKey && e.key === 'ArrowDown';
    const isArrBtn = e.target.classList.contains('arr-btn');
    const isPlainUp = isArrBtn && e.key === 'ArrowUp';
    const isPlainDown = isArrBtn && e.key === 'ArrowDown';

    if (isAltUp || isAltDown || isPlainUp || isPlainDown) {
      e.preventDefault();
      const step = (isAltUp || isPlainUp) ? -1 : 1;
      const kind = group.dataset.kind;
      const list = kind === 'required' ? t.required : t.optional;
      const itemId = group.dataset.id;
      const idx = list.findIndex(x => x.id === itemId);

      if (moveItemInList(list, idx, step)) {
        saveTypes();
        renderEditView();
        const newGroup = editPane.querySelector(`.edit-item-group[data-id="${itemId}"]`);
        if (newGroup) {
          if (isArrBtn) {
            const btn = newGroup.querySelector(`[data-move="${step}"]`) || newGroup.querySelector('.arr-btn');
            if (btn && !btn.disabled) btn.focus();
          } else {
            const cls = e.target.className.split(' ')[0];
            const el = cls ? newGroup.querySelector(`.${cls}`) : null;
            if (el) el.focus();
            else newGroup.querySelector('.el-label')?.focus();
          }
        }
      }
    }
  };

  editPane.oninput = (e) => {
    const group = e.target.closest('.edit-item-group');
    if (!group) return;
    const kind = group.dataset.kind;
    const list = kind === 'required' ? t.required : t.optional;
    const item = list.find(x => x.id === group.dataset.id);
    if (!item) return;

    if (e.target.classList.contains('el-label')) item.label = e.target.value;
    else if (e.target.classList.contains('el-len')) item.len = Math.max(0, parseInt(e.target.value, 10) || 0);
    else if (e.target.classList.contains('el-article')) item.article = e.target.value.trim();
    else if (e.target.classList.contains('el-info')) {
      item.info = e.target.value;
      const btn = group.querySelector('.btn-toggle-drawer');
      if (btn) btn.classList.toggle('has-rich', !!(item.article || item.info));
    }
    saveTypes();
  };
}

/* ==========================================================================
   Settings Screen Handlers
   ========================================================================== */
const settingsView = document.getElementById('settingsView');
const btnSettings = document.getElementById('btnSettings');
const btnBackSettings = document.getElementById('btnBackSettings');

btnSettings.onclick = () => {
  settingsView.style.display = 'flex';
  renderSettingsView();
};
btnBackSettings.onclick = () => {
  settingsView.style.display = 'none';
};

function renderSettingsView() {
  const themeChips = document.getElementById('themeChips');
  themeChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.themeVal === settings.theme);
    c.onclick = () => {
      applyTheme(c.dataset.themeVal);
      renderSettingsView();
    };
  });

  const acChips = document.getElementById('autoClearChips');
  acChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.ac, 10) === settings.autoClear);
    c.onclick = () => {
      settings.autoClear = parseInt(c.dataset.ac, 10);
      Storage.set('vpad.settings', settings);
      renderSettingsView();
    };
  });

  // Export Configuration & Data
  const btnExportData = document.getElementById('btnExportData');
  if (btnExportData) {
    btnExportData.onclick = () => {
      const payload = {
        app: 'vetting-notepad',
        version: 1,
        exportedAt: new Date().toISOString(),
        types,
        settings,
        savedComments,
        activeTypeId
      };
      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vetting_notepad_config_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showBanner('Configuration exported', null, null, 2500, 'info');
    };
  }

  // Import Configuration & Data
  const btnImportData = document.getElementById('btnImportData');
  const importFileInput = document.getElementById('importFileInput');
  if (btnImportData && importFileInput) {
    btnImportData.onclick = () => {
      importFileInput.click();
    };

    importFileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const confirmed = window.confirm(
        'Warning: Importing data will overwrite your current vetting types and configuration.\n\nDo you want to continue?'
      );
      if (!confirmed) {
        importFileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const raw = evt.target.result;
          const data = JSON.parse(raw);
          if (!data || !Array.isArray(data.types) || data.types.length === 0) {
            throw new Error('Invalid format: types array missing');
          }

          types = data.types;
          if (data.settings && typeof data.settings === 'object') {
            settings = Object.assign(settings, data.settings);
          }
          if (Array.isArray(data.savedComments)) {
            savedComments = data.savedComments;
          }
          if (data.activeTypeId && types.some(t => t.id === data.activeTypeId)) {
            activeTypeId = data.activeTypeId;
          } else {
            activeTypeId = types[0].id;
          }

          formValues = {};
          itemStatus = {};

          saveTypes();
          saveSettings();
          saveComments();

          applyTheme(settings.theme || 'auto');
          refreshTypeSelect();
          renderForm();
          updateCommentInput();
          renderSettingsView();

          showBanner('Configuration imported successfully', null, null, 3000, 'info');
        } catch (err) {
          console.error('Import error:', err);
          showBanner('Import failed: ' + (err.message || 'Invalid JSON file'), null, null, 3500, 'danger');
        } finally {
          importFileInput.value = '';
        }
      };
      reader.readAsText(file);
    };
  }

  document.getElementById('btnResetAll').onclick = () => {
    if (confirm('Reset all vetting types and configuration to factory defaults?')) {
      types = defaultVettingTypes();
      activeTypeId = types[0].id;
      formValues = {};
      itemStatus = {};
      saveTypes();
      settingsView.style.display = 'none';
      refreshTypeSelect();
      renderForm();
      updateCommentInput();
    }
  };
}

/* ==========================================================================
   Keyboard Shortcuts
   ========================================================================== */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    doCopy();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (typeSelectComponent) {
      typeSelectComponent.open();
      typeSelectComponent.input.focus();
    }
  }
});

// Clamp minimum window width to 250px on window resize
let resizeClampTimer = null;
window.addEventListener('resize', () => {
  if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.getCurrent) {
    if (window.outerWidth < 250) {
      if (resizeClampTimer) clearTimeout(resizeClampTimer);
      resizeClampTimer = setTimeout(() => {
        chrome.windows.getCurrent((w) => {
          if (w && typeof w.width === 'number' && w.width < 250) {
            chrome.windows.update(w.id, { width: 250 });
          }
        });
      }, 50);
    }
  }
});

document.addEventListener('pointerdown', (e) => {
  const pop = document.getElementById('activeSakaPopover');
  if (pop && !pop.contains(e.target) && !e.target.closest('.mat-info-btn')) {
    closeInfoPopover();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeInfoPopover();
  }
});

/* ==========================================================================
   Initialization
   ========================================================================== */
async function init() {
  const configVer = await Storage.get('vpad.config_version', 0);
  const loadedTypes = await Storage.get('vpad.types', null);

  if (configVer < 7 || !Array.isArray(loadedTypes) || loadedTypes.length < 13) {
    types = defaultVettingTypes();
    Storage.setMultiple({
      'vpad.types': types,
      'vpad.config_version': 7
    });
  } else {
    types = loadedTypes;
  }

  const loadedSettings = await Storage.get('vpad.settings', null);
  if (loadedSettings) settings = Object.assign(settings, loadedSettings);

  activeTypeId = await Storage.get('vpad.active', types[0].id);
  if (!types.some(t => t.id === activeTypeId)) activeTypeId = types[0].id;

  applyTheme(settings.theme || 'auto');
  initTypeSelect();
  renderForm();
  updateCommentInput();
}

init();

})();
