import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create } from 'react-test-renderer';

import { DailyQuestion } from '@/lib/checkin';

import { QuestionInput } from './checkin';

/**
 * Q3 (12 July, live cohort bug): checkin.tsx's binary branch hardcoded
 * ['Yes', 'No'] and ignored question.options — a real cohort user got
 * "Did today's practice feel like want to, or have to?" rendered with
 * generic Yes/No buttons instead of the bank's own designed pair.
 */
function binaryQuestion(options: string[] | null): DailyQuestion {
  return {
    id: 'q1',
    dimension: 'MOT',
    prompt: 'Did today practice feel like want to, or have to?',
    format: 'binary',
    depth: 'L1',
    options,
  };
}

function renderQuestionInput(question: DailyQuestion, onChange: (v: string) => void) {
  let renderer: ReturnType<typeof create> | null = null;
  act(() => {
    renderer = create(
      React.createElement(QuestionInput, { question, value: '', onChange })
    );
  });
  return renderer!;
}

describe('QuestionInput — binary format renders its own two options', () => {
  it('renders the real bank labels (not Yes/No) when options has exactly 2 entries', () => {
    const renderer = renderQuestionInput(binaryQuestion(['want to', 'have to']), () => {});
    const labels = renderer.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .flat();
    expect(labels).toContain('want to');
    expect(labels).toContain('have to');
    expect(labels).not.toContain('Yes');
    expect(labels).not.toContain('No');
  });

  it('stores the tapped option verbatim, exactly like the chips branch', () => {
    const onChange = jest.fn();
    const renderer = renderQuestionInput(binaryQuestion(['want to', 'have to']), onChange);
    const buttons = renderer.root.findAllByType(TouchableOpacity);
    act(() => {
      buttons[0].props.onPress();
    });
    expect(onChange).toHaveBeenCalledWith('want to');
  });

  it('falls back to Yes/No when options is null', () => {
    const renderer = renderQuestionInput(binaryQuestion(null), () => {});
    const labels = renderer.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .flat();
    expect(labels).toContain('Yes');
    expect(labels).toContain('No');
  });

  it('falls back to Yes/No when options is malformed (not exactly 2 entries)', () => {
    const renderer = renderQuestionInput(binaryQuestion(['only one']), () => {});
    const labels = renderer.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .flat();
    expect(labels).toContain('Yes');
    expect(labels).toContain('No');
  });
});
