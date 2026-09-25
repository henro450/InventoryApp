import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Line, Text as SvgText } from 'react-native-svg';
import { Text } from './ui';
import { colors, fonts } from '../theme';
import { formatMoney } from '../utils/format';

const HEIGHT = 150;
const PAD = { top: 16, right: 12, bottom: 24, left: 12 };
const SERIES = [
  { key: 'purchase', label: 'Purchase', color: colors.primary },
  { key: 'sale', label: 'Sale', color: colors.ink },
];

// PRC-04: price history for one item as a line per price type (purchase / sale).
export default function PriceTrendChart({ history }) {
  const [width, setWidth] = useState(0);
  const points = history
    .map((h) => ({ ...h, t: new Date(h.effectiveDate).getTime(), amount: Number(h.amount) }))
    .sort((a, b) => a.t - b.t);

  if (points.length === 0) return null;

  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const amounts = points.map((p) => p.amount);
  let minA = Math.min(...amounts);
  let maxA = Math.max(...amounts);
  if (minA === maxA) {
    minA -= 1;
    maxA += 1;
  }
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + (maxT === minT ? innerW / 2 : ((t - minT) / (maxT - minT)) * innerW);
  const y = (a) => PAD.top + (1 - (a - minA) / (maxA - minA)) * innerH;
  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  const present = SERIES.filter((s) => points.some((p) => p.priceType === s.key));

  return (
    <View style={{ gap: 10 }}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityLabel={`Price trend from ${formatMoney(points[0].amount)} to ${formatMoney(points[points.length - 1].amount)}`}
      >
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            <Line x1={PAD.left} x2={width - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} stroke={colors.line} />
            <Line x1={PAD.left} x2={width - PAD.right} y1={PAD.top} y2={PAD.top} stroke={colors.lineSoft} />
            {present.map((s) => {
              const pts = points.filter((p) => p.priceType === s.key);
              const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.amount).toFixed(1)}`).join(' ');
              return (
                <React.Fragment key={s.key}>
                  <Path d={d} stroke={s.color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  {pts.map((p, i) => (
                    <Circle key={i} cx={x(p.t)} cy={y(p.amount)} r={4} fill={colors.surface} stroke={s.color} strokeWidth={2} />
                  ))}
                </React.Fragment>
              );
            })}
            <SvgText x={PAD.left} y={HEIGHT - 6} fontSize={11} fill={colors.ink3} fontFamily={fonts.regular}>
              {fmtDate(minT)}
            </SvgText>
            <SvgText x={width - PAD.right} y={HEIGHT - 6} fontSize={11} fill={colors.ink3} fontFamily={fonts.regular} textAnchor="end">
              {fmtDate(maxT)}
            </SvgText>
            <SvgText x={width - PAD.right} y={PAD.top - 4} fontSize={11} fill={colors.ink} fontFamily={fonts.semibold} textAnchor="end">
              {formatMoney(maxA)}
            </SvgText>
          </Svg>
        )}
      </View>
      <View style={styles.legend}>
        {present.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 12, color: colors.ink2 },
});
