import { createHash } from 'node:crypto';
import { walkingPolicy, type WalkingCommand } from '../../contracts/walking';
import { ServiceError } from '../services/meetup';

export const fail = (status: number, code: string, message: string): never => {
  throw new ServiceError(status, code, message);
};
export const seoulDay = (time: number) => new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
export const shiftDay = (day: string, count: number) =>
  new Date(Date.parse(day + 'T00:00:00Z') + count * 86400000).toISOString().slice(0, 10);
export const recentDay = (day: string, today: string) => day >= shiftDay(today, -7) && day <= today;
export const dailyPoints = (steps: number) => Math.floor(Math.min(steps, walkingPolicy.dailyCap) / walkingPolicy.stepsPerPoint);
export function canonicalCommand(command: WalkingCommand): WalkingCommand {
  if (command.action === 'bindHealth') return { ...command, deviceId: command.deviceId.toLowerCase() };
  if (command.action === 'leaveExpedition' || command.action === 'claimStage')
    return { ...command, expeditionId: command.expeditionId.toLowerCase() };
  if (command.action !== 'syncHealth') return command;
  const days = [...command.days].sort((a, b) => a.day.localeCompare(b.day));
  if (new Set(days.map((day) => day.day)).size !== days.length)
    fail(400, 'DUPLICATE_DAY', '하루의 걸음 기록은 한 번만 보내 주세요.');
  return { ...command, sourceId: command.sourceId.toLowerCase(), days };
}
export const fingerprint = (input: WalkingCommand) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export const iso = (date: Date | string) => new Date(date).toISOString();
