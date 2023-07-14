import { BigNumber } from 'bignumber.js';
import { Json } from '@metamask/utils';
import { IndividualTxFees } from '@metamask/smart-transactions-controller/dist/types';
import {
  ALLOWED_CONTRACT_ADDRESSES,
  ARBITRUM,
  AVALANCHE,
  BSC,
  ETHEREUM,
  GOERLI,
  OPTIMISM,
  POLYGON,
  SWAPS_API_V2_BASE_URL,
  SWAPS_CHAINID_DEFAULT_TOKEN_MAP,
  SWAPS_CLIENT_ID,
  SWAPS_DEV_API_V2_BASE_URL,
  SwapsTokenObject,
} from '../../../shared/constants/swaps';
import {
  isSwapsDefaultTokenAddress,
  isSwapsDefaultTokenSymbol,
} from '../../../shared/modules/swaps.utils';
import { CHAIN_IDS } from '../../../shared/constants/network';
import { formatCurrency } from '../../helpers/utils/confirm-tx.util';
import fetchWithCache from '../../../shared/lib/fetch-with-cache';

import { isValidHexAddress } from '../../../shared/modules/hexstring-utils';
import {
  calcGasTotal,
  calcTokenAmount,
  toPrecisionWithoutTrailingZeros,
} from '../../../shared/lib/transactions-controller-utils';
import {
  getBaseApi,
  truthyString,
  validateData,
} from '../../../shared/lib/swaps-utils';
import {
  decimalToHex,
  getValueFromWeiHex,
  sumHexes,
} from '../../../shared/modules/conversion.utils';
import { EtherDenomination } from '../../../shared/constants/common';

const CACHE_REFRESH_FIVE_MINUTES = 300000;
const USD_CURRENCY_CODE = 'usd';

const clientIdHeader = { 'X-Client-Id': SWAPS_CLIENT_ID };

interface Validator {
  property: string;
  type: string;
  validator: (a: string) => boolean;
}

const TOKEN_VALIDATORS: Validator[] = [
  {
    property: 'address',
    type: 'string',
    validator: (input) => isValidHexAddress(input, { allowNonPrefixed: false }),
  },
  {
    property: 'symbol',
    type: 'string',
    validator: (string) => truthyString(string) && string.length <= 12,
  },
  {
    property: 'decimals',
    type: 'string|number',
    validator: (string) => Number(string) >= 0 && Number(string) <= 36,
  },
];

const TOP_ASSET_VALIDATORS = TOKEN_VALIDATORS.slice(0, 2);

const AGGREGATOR_METADATA_VALIDATORS: Validator[] = [
  {
    property: 'color',
    type: 'string',
    validator: (string) => Boolean(string.match(/^#[A-Fa-f0-9]+$/u)),
  },
  {
    property: 'title',
    type: 'string',
    validator: truthyString,
  },
  {
    property: 'icon',
    type: 'string',
    validator: (string) => Boolean(string.match(/^data:image/u)),
  },
];

const isValidDecimalNumber = (string: any): boolean =>
  !isNaN(string) && string.match(/^[.0-9]+$/u) && !isNaN(parseFloat(string));

const SWAP_GAS_PRICE_VALIDATOR: Validator[] = [
  {
    property: 'SafeGasPrice',
    type: 'string',
    validator: isValidDecimalNumber,
  },
  {
    property: 'ProposeGasPrice',
    type: 'string',
    validator: isValidDecimalNumber,
  },
  {
    property: 'FastGasPrice',
    type: 'string',
    validator: isValidDecimalNumber,
  },
];

export async function fetchToken(
  contractAddress: string,
  caipChainId: any,
): Promise<Json> {
  const tokenUrl = getBaseApi('token', caipChainId);
  return await fetchWithCache(
    `${tokenUrl}?address=${contractAddress}`,
    { method: 'GET', headers: clientIdHeader },
    { cacheRefreshTime: CACHE_REFRESH_FIVE_MINUTES },
  );
}

type Token = { symbol: string; address: string };
export async function fetchTokens(
  caipChainId: keyof typeof SWAPS_CHAINID_DEFAULT_TOKEN_MAP,
): Promise<SwapsTokenObject[]> {
  const tokensUrl = getBaseApi('tokens', caipChainId);
  const tokens = await fetchWithCache(
    tokensUrl,
    { method: 'GET', headers: clientIdHeader },
    { cacheRefreshTime: CACHE_REFRESH_FIVE_MINUTES },
  );
  const logError = false;
  const tokenObject = SWAPS_CHAINID_DEFAULT_TOKEN_MAP[caipChainId] || null;
  return [
    tokenObject,
    ...tokens.filter((token: Token) => {
      return (
        validateData(TOKEN_VALIDATORS, token, tokensUrl, logError) &&
        !(
          isSwapsDefaultTokenSymbol(token.symbol, caipChainId) ||
          isSwapsDefaultTokenAddress(token.address, caipChainId)
        )
      );
    }),
  ];
}

export async function fetchAggregatorMetadata(caipChainId: any): Promise<object> {
  const aggregatorMetadataUrl = getBaseApi('aggregatorMetadata', caipChainId);
  const aggregators = await fetchWithCache(
    aggregatorMetadataUrl,
    { method: 'GET', headers: clientIdHeader },
    { cacheRefreshTime: CACHE_REFRESH_FIVE_MINUTES },
  );
  const filteredAggregators = {} as any;
  for (const aggKey in aggregators) {
    if (
      validateData(
        AGGREGATOR_METADATA_VALIDATORS,
        aggregators[aggKey],
        aggregatorMetadataUrl,
      )
    ) {
      filteredAggregators[aggKey] = aggregators[aggKey];
    }
  }
  return filteredAggregators;
}

export async function fetchTopAssets(caipChainId: any): Promise<object> {
  const topAssetsUrl = getBaseApi('topAssets', caipChainId);
  const response =
    (await fetchWithCache(
      topAssetsUrl,
      { method: 'GET', headers: clientIdHeader },
      { cacheRefreshTime: CACHE_REFRESH_FIVE_MINUTES },
    )) || [];
  const topAssetsMap = response.reduce(
    (_topAssetsMap: any, asset: { address: string }, index: number) => {
      if (validateData(TOP_ASSET_VALIDATORS, asset, topAssetsUrl)) {
        return { ..._topAssetsMap, [asset.address]: { index: String(index) } };
      }
      return _topAssetsMap;
    },
    {},
  );
  return topAssetsMap;
}

export async function fetchSwapsFeatureFlags(): Promise<any> {
  const v2ApiBaseUrl = process.env.SWAPS_USE_DEV_APIS
    ? SWAPS_DEV_API_V2_BASE_URL
    : SWAPS_API_V2_BASE_URL;
  return await fetchWithCache(
    `${v2ApiBaseUrl}/featureFlags`,
    { method: 'GET', headers: clientIdHeader },
    { cacheRefreshTime: 600000 },
  );
}

export async function fetchTokenPrice(address: string): Promise<any> {
  const query = `contract_addresses=${address}&vs_currencies=eth`;

  const prices = await fetchWithCache(
    `https://api.coingecko.com/api/v3/simple/token_price/ethereum?${query}`,
    { method: 'GET' },
    { cacheRefreshTime: 60000 },
  );
  return prices?.[address]?.eth;
}

export async function fetchSwapsGasPrices(caipChainId: any): Promise<
  | any
  | {
      safeLow: string;
      average: string;
      fast: string;
    }
> {
  const gasPricesUrl = getBaseApi('gasPrices', caipChainId);
  const response = await fetchWithCache(
    gasPricesUrl,
    { method: 'GET', headers: clientIdHeader },
    { cacheRefreshTime: 30000 },
  );
  const responseIsValid = validateData(
    SWAP_GAS_PRICE_VALIDATOR,
    response,
    gasPricesUrl,
  );

  if (!responseIsValid) {
    throw new Error(`${gasPricesUrl} response is invalid`);
  }

  const {
    SafeGasPrice: safeLow,
    ProposeGasPrice: average,
    FastGasPrice: fast,
  } = response;

  return {
    safeLow,
    average,
    fast,
  };
}

export const getFeeForSmartTransaction = ({
  caipChainId,
  currentCurrency,
  conversionRate,
  USDConversionRate,
  nativeCurrencySymbol,
  feeInWeiDec,
}: {
  caipChainId: keyof typeof SWAPS_CHAINID_DEFAULT_TOKEN_MAP;
  currentCurrency: string;
  conversionRate: number;
  USDConversionRate?: number;
  nativeCurrencySymbol: string;
  feeInWeiDec: number;
}) => {
  const feeInWeiHex = decimalToHex(feeInWeiDec);
  const ethFee = getValueFromWeiHex({
    value: feeInWeiHex,
    toDenomination: EtherDenomination.ETH,
    numberOfDecimals: 5,
  });
  const rawNetworkFees = getValueFromWeiHex({
    value: feeInWeiHex,
    toCurrency: currentCurrency,
    conversionRate,
    numberOfDecimals: 2,
  });
  let feeInUsd;
  if (currentCurrency === USD_CURRENCY_CODE) {
    feeInUsd = rawNetworkFees;
  } else {
    feeInUsd = getValueFromWeiHex({
      value: feeInWeiHex,
      toCurrency: USD_CURRENCY_CODE,
      conversionRate: USDConversionRate,
      numberOfDecimals: 2,
    });
  }
  const formattedNetworkFee = formatCurrency(rawNetworkFees, currentCurrency);
  const chainCurrencySymbolToUse =
    nativeCurrencySymbol || SWAPS_CHAINID_DEFAULT_TOKEN_MAP[caipChainId]?.symbol;
  return {
    feeInUsd,
    feeInFiat: formattedNetworkFee,
    feeInEth: `${ethFee} ${chainCurrencySymbolToUse}`,
    rawEthFee: ethFee,
  };
};

export function getRenderableNetworkFeesForQuote({
  tradeGas,
  approveGas,
  gasPrice,
  currentCurrency,
  conversionRate,
  USDConversionRate,
  tradeValue,
  sourceSymbol,
  sourceAmount,
  caipChainId,
  nativeCurrencySymbol,
  multiLayerL1FeeTotal,
}: {
  tradeGas: string;
  approveGas: string;
  gasPrice: string;
  currentCurrency: string;
  conversionRate: number;
  USDConversionRate?: number;
  tradeValue: number;
  sourceSymbol: string;
  sourceAmount: number;
  caipChainId: keyof typeof SWAPS_CHAINID_DEFAULT_TOKEN_MAP;
  nativeCurrencySymbol?: string;
  multiLayerL1FeeTotal: string | null;
}): {
  rawNetworkFees: string | number | BigNumber;
  feeInUsd: string | number | BigNumber;
  rawEthFee: string | number | BigNumber;
  feeInFiat: string;
  feeInEth: string;
  nonGasFee: string;
} {
  const totalGasLimitForCalculation = new BigNumber(tradeGas || '0x0', 16)
    .plus(approveGas || '0x0', 16)
    .toString(16);
  let gasTotalInWeiHex = calcGasTotal(totalGasLimitForCalculation, gasPrice);
  if (multiLayerL1FeeTotal !== null) {
    gasTotalInWeiHex = sumHexes(
      gasTotalInWeiHex || '0x0',
      multiLayerL1FeeTotal || '0x0',
    );
  }

  const nonGasFee = new BigNumber(tradeValue, 16)
    .minus(
      isSwapsDefaultTokenSymbol(sourceSymbol, caipChainId) ? sourceAmount : 0,
      10,
    )
    .toString(16);

  const totalWeiCost = new BigNumber(gasTotalInWeiHex, 16)
    .plus(nonGasFee, 16)
    .toString(16);
  const ethFee = getValueFromWeiHex({
    value: totalWeiCost,
    toDenomination: EtherDenomination.ETH,
    numberOfDecimals: 5,
  });
  const rawNetworkFees = getValueFromWeiHex({
    value: totalWeiCost,
    toCurrency: currentCurrency,
    conversionRate,
    numberOfDecimals: 2,
  });
  const formattedNetworkFee = formatCurrency(rawNetworkFees, currentCurrency);

  let feeInUsd;
  if (currentCurrency === USD_CURRENCY_CODE) {
    feeInUsd = rawNetworkFees;
  } else {
    feeInUsd = getValueFromWeiHex({
      value: totalWeiCost,
      toCurrency: USD_CURRENCY_CODE,
      conversionRate: USDConversionRate,
      numberOfDecimals: 2,
    });
  }

  const chainCurrencySymbolToUse =
    nativeCurrencySymbol || SWAPS_CHAINID_DEFAULT_TOKEN_MAP[caipChainId].symbol;

  return {
    rawNetworkFees,
    feeInUsd,
    rawEthFee: ethFee,
    feeInFiat: formattedNetworkFee,
    feeInEth: `${ethFee} ${chainCurrencySymbolToUse}`,
    nonGasFee,
  };
}

export function quotesToRenderableData({
  quotes,
  gasPrice,
  conversionRate,
  currentCurrency,
  approveGas,
  tokenConversionRates,
  caipChainId,
  smartTransactionEstimatedGas,
  nativeCurrencySymbol,
  multiLayerL1ApprovalFeeTotal,
}: {
  quotes: object;
  gasPrice: string;
  conversionRate: number;
  currentCurrency: string;
  approveGas: string;
  tokenConversionRates: Record<string, any>;
  caipChainId: keyof typeof SWAPS_CHAINID_DEFAULT_TOKEN_MAP;
  smartTransactionEstimatedGas: IndividualTxFees;
  nativeCurrencySymbol: string;
  multiLayerL1ApprovalFeeTotal: string | null;
}): Record<string, any> {
  return Object.values(quotes).map((quote) => {
    const {
      destinationAmount = 0,
      sourceAmount = 0,
      sourceTokenInfo,
      destinationTokenInfo,
      slippage,
      aggType,
      aggregator,
      gasEstimateWithRefund,
      averageGas,
      fee,
      trade,
      multiLayerL1TradeFeeTotal,
    } = quote;
    let multiLayerL1FeeTotal = null;
    if (
      multiLayerL1TradeFeeTotal !== null &&
      multiLayerL1ApprovalFeeTotal !== null
    ) {
      multiLayerL1FeeTotal = sumHexes(
        multiLayerL1TradeFeeTotal || '0x0',
        multiLayerL1ApprovalFeeTotal || '0x0',
      );
    } else if (multiLayerL1TradeFeeTotal !== null) {
      multiLayerL1FeeTotal = multiLayerL1TradeFeeTotal;
    }
    const sourceValue = calcTokenAmount(
      sourceAmount,
      sourceTokenInfo.decimals,
    ).toString(10);
    const destinationValue = calcTokenAmount(
      destinationAmount,
      destinationTokenInfo.decimals,
    ).toPrecision(8);

    let feeInFiat = null;
    let feeInEth = null;
    let rawNetworkFees = null;
    let rawEthFee = null;

    ({ feeInFiat, feeInEth, rawNetworkFees, rawEthFee } =
      getRenderableNetworkFeesForQuote({
        tradeGas: gasEstimateWithRefund || decimalToHex(averageGas || 800000),
        approveGas,
        gasPrice,
        currentCurrency,
        conversionRate,
        tradeValue: trade.value,
        sourceSymbol: sourceTokenInfo.symbol,
        sourceAmount,
        caipChainId,
        multiLayerL1FeeTotal,
      }));

    if (smartTransactionEstimatedGas) {
      ({ feeInFiat, feeInEth } = getFeeForSmartTransaction({
        caipChainId,
        currentCurrency,
        conversionRate,
        nativeCurrencySymbol,
        feeInWeiDec: smartTransactionEstimatedGas.feeEstimate,
      }));
    }

    const slippageMultiplier = new BigNumber(100 - slippage).div(100);
    const minimumAmountReceived = new BigNumber(destinationValue)
      .times(slippageMultiplier)
      .toFixed(6);

    const tokenConversionRate =
      tokenConversionRates[destinationTokenInfo.address];
    const ethValueOfTrade = isSwapsDefaultTokenSymbol(
      destinationTokenInfo.symbol,
      caipChainId,
    )
      ? calcTokenAmount(destinationAmount, destinationTokenInfo.decimals).minus(
          rawEthFee,
          10,
        )
      : new BigNumber(tokenConversionRate || 0, 10)
          .times(
            calcTokenAmount(destinationAmount, destinationTokenInfo.decimals),
            10,
          )
          .minus(rawEthFee, 10);

    let liquiditySourceKey;
    let renderedSlippage = slippage;

    if (aggType === 'AGG') {
      liquiditySourceKey = 'swapAggregator';
    } else if (aggType === 'RFQ') {
      liquiditySourceKey = 'swapRequestForQuotation';
      renderedSlippage = 0;
    } else if (aggType === 'DEX') {
      liquiditySourceKey = 'swapDecentralizedExchange';
    } else if (aggType === 'CONTRACT') {
      liquiditySourceKey = 'swapDirectContract';
    } else {
      liquiditySourceKey = 'swapUnknown';
    }

    return {
      aggId: aggregator,
      amountReceiving: `${destinationValue} ${destinationTokenInfo.symbol}`,
      destinationTokenDecimals: destinationTokenInfo.decimals,
      destinationTokenSymbol: destinationTokenInfo.symbol,
      destinationTokenValue: formatSwapsValueForDisplay(destinationValue),
      destinationIconUrl: destinationTokenInfo.iconUrl,
      isBestQuote: quote.isBestQuote,
      liquiditySourceKey,
      feeInEth,
      detailedNetworkFees: `${feeInEth} (${feeInFiat})`,
      networkFees: feeInFiat,
      quoteSource: aggType,
      rawNetworkFees,
      slippage: renderedSlippage,
      sourceTokenDecimals: sourceTokenInfo.decimals,
      sourceTokenSymbol: sourceTokenInfo.symbol,
      sourceTokenValue: sourceValue,
      sourceTokenIconUrl: sourceTokenInfo.iconUrl,
      ethValueOfTrade,
      minimumAmountReceived,
      metaMaskFee: fee,
    };
  });
}

export function formatSwapsValueForDisplay(destinationAmount: string): string {
  let amountToDisplay = toPrecisionWithoutTrailingZeros(destinationAmount, 12);
  if (amountToDisplay.match(/e[+-]/u)) {
    amountToDisplay = new BigNumber(amountToDisplay).toFixed();
  }
  return amountToDisplay;
}

export const getClassNameForCharLength = (
  num: string,
  classNamePrefix: string,
): string => {
  let modifier;
  if (!num || num.length <= 10) {
    modifier = 'lg';
  } else if (num.length > 10 && num.length <= 13) {
    modifier = 'md';
  } else {
    modifier = 'sm';
  }
  return `${classNamePrefix}--${modifier}`;
};

/**
 * Checks whether a contract address is valid before swapping tokens.
 *
 * @param contractAddress - E.g. "0x881d40237659c251811cec9c364ef91dc08d300c" for mainnet
 * @param caipChainId - The hex encoded chain ID to check
 * @returns Whether a contract address is valid or not
 */
export const isContractAddressValid = (
  contractAddress: string,
  caipChainId: keyof typeof ALLOWED_CONTRACT_ADDRESSES,
): boolean => {
  if (!contractAddress || !ALLOWED_CONTRACT_ADDRESSES[caipChainId]) {
    return false;
  }
  return ALLOWED_CONTRACT_ADDRESSES[caipChainId].some(
    // Sometimes we get a contract address with a few upper-case chars and since addresses are
    // case-insensitive, we compare lowercase versions for validity.
    (allowedContractAddress: string) =>
      contractAddress.toLowerCase() === allowedContractAddress.toLowerCase(),
  );
};

/**
 * @param caipChainId
 * @returns string e.g. ethereum, bsc or polygon
 */
export const getNetworkNameByChainId = (caipChainId: string): string => {
  switch (caipChainId) {
    case CHAIN_IDS.MAINNET:
      return ETHEREUM;
    case CHAIN_IDS.BSC:
      return BSC;
    case CHAIN_IDS.POLYGON:
      return POLYGON;
    case CHAIN_IDS.GOERLI:
      return GOERLI;
    case CHAIN_IDS.AVALANCHE:
      return AVALANCHE;
    case CHAIN_IDS.OPTIMISM:
      return OPTIMISM;
    case CHAIN_IDS.ARBITRUM:
      return ARBITRUM;
    default:
      return '';
  }
};

/**
 * It returns info about if Swaps are enabled and if we should use our new APIs for it.
 *
 * @param caipChainId
 * @param swapsFeatureFlags
 * @returns object with 2 items: "swapsFeatureIsLive"
 */
export const getSwapsLivenessForNetwork = (
  caipChainId: any,
  swapsFeatureFlags: any = {},
) => {
  const networkName = getNetworkNameByChainId(caipChainId);
  // Use old APIs for testnet and Goerli.
  if ([CHAIN_IDS.LOCALHOST, CHAIN_IDS.GOERLI].includes(caipChainId)) {
    return {
      swapsFeatureIsLive: true,
    };
  }
  // If a network name is not found in the list of feature flags, disable Swaps.
  if (!swapsFeatureFlags[networkName]) {
    return {
      swapsFeatureIsLive: false,
    };
  }
  const isNetworkEnabledForNewApi =
    swapsFeatureFlags[networkName].extensionActive;
  if (isNetworkEnabledForNewApi) {
    return {
      swapsFeatureIsLive: true,
    };
  }
  return {
    swapsFeatureIsLive: swapsFeatureFlags[networkName].fallbackToV1,
  };
};

/**
 * @param value
 * @returns number
 */
export const countDecimals = (value: any): number => {
  if (!value || Math.floor(value) === value) {
    return 0;
  }
  return value.toString().split('.')[1]?.length || 0;
};

export const showRemainingTimeInMinAndSec = (
  remainingTimeInSec: any,
): string => {
  if (!Number.isInteger(remainingTimeInSec)) {
    return '0:00';
  }
  const minutes = Math.floor(remainingTimeInSec / 60);
  const seconds = remainingTimeInSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export enum StxErrorTypes {
  unavailable = 'unavailable',
  notEnoughFunds = 'not_enough_funds',
  regularTxPending = 'regular_tx_pending',
}

export const getTranslatedStxErrorMessage = (
  errorType: StxErrorTypes,
  t: (...args: any[]) => string,
): string => {
  switch (errorType) {
    case StxErrorTypes.unavailable:
    case StxErrorTypes.regularTxPending:
      return t('smartSwapsErrorUnavailable');
    case StxErrorTypes.notEnoughFunds:
      return t('smartSwapsErrorNotEnoughFunds');
    default:
      return t('smartSwapsErrorUnavailable');
  }
};

export const parseSmartTransactionsError = (errorMessage: string): string => {
  const errorJson = errorMessage.slice(12);
  return JSON.parse(errorJson.trim());
};
