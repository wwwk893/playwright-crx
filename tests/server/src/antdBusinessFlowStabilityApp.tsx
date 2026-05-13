import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, Button, Card, ConfigProvider, Form, Input, Select, Space, Table, Tag, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';

import 'antd/dist/reset.css';

type SavedRow = {
  key: string;
  name: string;
  wan?: string;
  remark?: string;
};

const wanOptions = [
  { label: 'WAN1', value: 'WAN1' },
  { label: 'WAN1-copy', value: 'WAN1-copy' },
  { label: 'WAN2', value: 'WAN2' },
  { label: 'WAN-disabled', value: 'WAN-disabled', disabled: true },
  ...Array.from({ length: 40 }, (_, index) => ({ label: `WAN-extra-${index + 1}`, value: `WAN-extra-${index + 1}` })),
];

function StabilityFixture() {
  const [form] = Form.useForm();
  const [rows, setRows] = React.useState<SavedRow[]>([]);
  const [events, setEvents] = React.useState<string[]>([]);

  const addEvent = React.useCallback((event: string) => {
    setEvents(current => [...current, event]);
  }, []);

  const save = React.useCallback(() => {
    const values = form.getFieldsValue();
    const name = values.poolName || `pool-${rows.length + 1}`;
    setRows(current => {
      const existing = current.filter(row => row.name !== name);
      return [...existing, {
        key: name,
        name,
        wan: values.wanPort,
        remark: values.remark,
      }];
    });
    addEvent(`save:${name}`);
  }, [addEvent, form, rows.length]);

  return <ConfigProvider locale={zhCN}>
    <App>
      <Card title='业务流程稳定性测试页' data-testid='stability-card' style={{ margin: 24 }}>
        <Space direction='vertical' size='large' style={{ width: '100%' }}>
          <Space>
            <Button data-testid='site-ip-add' type='primary' onClick={() => addEvent('add')}>新增IP端口池</Button>
            <Button data-testid='site-ip-validate' onClick={() => addEvent('validate')}>校验配置</Button>
            <Button data-testid='site-save-button' onClick={save}>保存配置</Button>
            <Button data-testid='site-post-save-action' onClick={() => addEvent('post-save')}>保存后动作</Button>
          </Space>

          <Form form={form} layout='vertical' name='stabilityForm' data-testid='stability-form'>
            <Form.Item label='地址池名称' name='poolName'>
              <Input placeholder='地址池名称' />
            </Form.Item>
            <Form.Item label='共享WAN' name='wanPort'>
              <Select
                data-testid='stability-wan-select'
                aria-label='共享WAN'
                placeholder='选择共享 WAN'
                showSearch
                optionFilterProp='label'
                options={wanOptions}
                virtual
              />
            </Form.Item>
            <Form.Item label='使用备注' name='remark'>
              <Input placeholder='填写使用备注' />
            </Form.Item>
          </Form>

          <Table
            data-testid='site-ip-address-pool-table'
            rowKey='key'
            size='small'
            pagination={false}
            dataSource={rows}
            columns={[
              { title: '地址池名称', dataIndex: 'name' },
              { title: '共享WAN', dataIndex: 'wan', render: value => value ? <Tag color='blue'>{value}</Tag> : '--' },
              { title: '备注', dataIndex: 'remark' },
            ]}
          />

          <section data-testid='event-log'>
            <Typography.Text strong>事件日志</Typography.Text>
            {events.map((event, index) => <div key={`${event}-${index}`}>{index + 1}. {event}</div>)}
          </section>
        </Space>
      </Card>
    </App>
  </ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<StabilityFixture />);
